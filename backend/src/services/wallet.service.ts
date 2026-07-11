import { Prisma, type Transfer } from "@prisma/client";
import { prisma } from "../prisma";
import { HttpError } from "../lib/HttpError";

// Postgres deadlock error, surfaced by Prisma's interactive transactions as
// P2034 ("Transaction failed due to a write conflict or a deadlock. Please
// retry your transaction") — Prisma does not retry this automatically, the
// caller is expected to (docs/architecture.md §7.2).
const DEADLOCK_ERROR_CODE = "P2034";
const MAX_TRANSFER_ATTEMPTS = 2;

// bigint isn't JSON-serializable (JSON.stringify throws on it), so every
// response DTO converts wallet/ledger amounts to strings — standard
// practice for large integers in JSON APIs, and avoids any precision loss
// a client-side float could introduce.
export interface TransferDTO {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  senderBalanceAfter: string;
  receiverBalanceAfter: string;
  createdAt: Date;
}

function serializeTransfer(t: Transfer): TransferDTO {
  return {
    id: t.id,
    senderId: t.senderId,
    receiverId: t.receiverId,
    amount: t.amount.toString(),
    senderBalanceAfter: t.senderBalanceAfter.toString(),
    receiverBalanceAfter: t.receiverBalanceAfter.toString(),
    createdAt: t.createdAt,
  };
}

export async function getBalance(userId: string): Promise<string> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balance.toString();
}

async function debitAndSnapshot(tx: Prisma.TransactionClient, userId: string, amount: number): Promise<bigint> {
  // The WHERE clause (not just a plain unique-key update) is what makes
  // this safe under concurrency: Postgres evaluates and locks the row as
  // part of the same statement, so a second concurrent debit against the
  // same wallet blocks until this one commits, then re-evaluates the
  // condition against the now-updated balance (docs/architecture.md §7.2).
  const result = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (result.count === 0) {
    throw new HttpError(409, "잔액이 부족합니다.");
  }
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balance;
}

async function creditAndSnapshot(tx: Prisma.TransactionClient, userId: string, amount: number): Promise<bigint> {
  await tx.wallet.update({ where: { userId }, data: { balance: { increment: amount } } });
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.balance;
}

async function findByIdempotencyKey(senderId: string, idempotencyKey: string): Promise<Transfer | null> {
  return prisma.transfer.findUnique({
    where: { senderId_idempotencyKey: { senderId, idempotencyKey } },
  });
}

export async function transfer(
  senderId: string,
  receiverId: string,
  amount: number,
  idempotencyKey: string
): Promise<TransferDTO> {
  // Idempotency pre-check: a retried request with the same key returns the
  // original result instead of moving money again (docs/architecture.md §7.3).
  const existing = await findByIdempotencyKey(senderId, idempotencyKey);
  if (existing) return serializeTransfer(existing);

  if (senderId === receiverId) {
    throw new HttpError(400, "본인에게는 송금할 수 없습니다.");
  }

  const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
  if (!receiver) {
    throw new HttpError(404, "받는 사람을 찾을 수 없습니다.");
  }
  if (receiver.status !== "active") {
    throw new HttpError(403, "휴면 계정에는 송금할 수 없습니다.");
  }

  for (let attempt = 1; attempt <= MAX_TRANSFER_ATTEMPTS; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // Always touch wallet rows in a fixed (id-sorted) order regardless
        // of who is sender/receiver, so a concurrent transfer in the
        // opposite direction (B->A while this is A->B) locks rows in the
        // same order instead of the classic circular-wait deadlock shape
        // (same pattern as chat_rooms' user_id_low/high sorting, §3/§7.2).
        let senderBalanceAfter: bigint;
        let receiverBalanceAfter: bigint;
        if (senderId < receiverId) {
          senderBalanceAfter = await debitAndSnapshot(tx, senderId, amount);
          receiverBalanceAfter = await creditAndSnapshot(tx, receiverId, amount);
        } else {
          receiverBalanceAfter = await creditAndSnapshot(tx, receiverId, amount);
          senderBalanceAfter = await debitAndSnapshot(tx, senderId, amount);
        }

        return tx.transfer.create({
          data: {
            senderId,
            receiverId,
            amount,
            idempotencyKey,
            senderBalanceAfter,
            receiverBalanceAfter,
          },
        });
      });

      return serializeTransfer(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Lost the race on (senderId, idempotencyKey) to a concurrent
        // identical request — the transaction (including the balance
        // changes) rolled back automatically, so no double-debit happened.
        // Return the winner's row instead of erroring.
        const winner = await findByIdempotencyKey(senderId, idempotencyKey);
        if (winner) return serializeTransfer(winner);
        throw err;
      }

      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === DEADLOCK_ERROR_CODE &&
        attempt < MAX_TRANSFER_ATTEMPTS
      ) {
        continue;
      }

      throw err;
    }
  }

  // Unreachable in practice (the loop always returns or throws), but keeps
  // the function's return type honest without a non-null assertion.
  throw new HttpError(500, "송금 처리 중 알 수 없는 오류가 발생했습니다.");
}

interface ListTransactionsOptions {
  before?: string;
  limit: number;
  direction: "sent" | "received" | "all";
}

export async function listTransactions(userId: string, options: ListTransactionsOptions): Promise<TransferDTO[]> {
  const where =
    options.direction === "sent"
      ? { senderId: userId }
      : options.direction === "received"
        ? { receiverId: userId }
        : { OR: [{ senderId: userId }, { receiverId: userId }] };

  const transfers = await prisma.transfer.findMany({
    where: {
      ...where,
      ...(options.before ? { createdAt: { lt: new Date(options.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit,
  });

  return transfers.map(serializeTransfer);
}

interface ListAllTransactionsOptions {
  cursor?: string;
  before?: string;
  limit: number;
  senderId?: string;
  receiverId?: string;
}

// Admin-only audit view over the whole ledger, unscoped to any one user
// (docs/architecture.md §9.3 GET /api/admin/wallet/transactions).
export async function listAllTransactions(options: ListAllTransactionsOptions) {
  const transfers = await prisma.transfer.findMany({
    where: {
      ...(options.senderId ? { senderId: options.senderId } : {}),
      ...(options.receiverId ? { receiverId: options.receiverId } : {}),
      ...(options.before ? { createdAt: { lt: new Date(options.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit + 1,
    ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
  });

  const hasMore = transfers.length > options.limit;
  const items = hasMore ? transfers.slice(0, options.limit) : transfers;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  return { items: items.map(serializeTransfer), nextCursor };
}
