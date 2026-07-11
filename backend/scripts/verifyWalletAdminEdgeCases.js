// Manual regression script for the wallet/admin edge cases called out in
// REPORT.md §15 — not part of the automated build, run by hand against a
// running dev server when touching wallet.service.ts, admin.service.ts, or
// the requireAdmin middleware:
//
//   npm run verify:wallet-admin --workspace backend
//
// Requires the backend dev server to already be running (npm run dev) and
// an existing admin account (see scripts/promoteAdmin.ts) — set
// VERIFY_ADMIN_USERNAME/VERIFY_ADMIN_PASSWORD to point at one, otherwise
// the admin-only checks are skipped rather than failing.
const BASE = process.env.VERIFY_BASE_URL || "http://localhost:4000";
const ADMIN_USERNAME = process.env.VERIFY_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.VERIFY_ADMIN_PASSWORD;

let pass = 0;
let fail = 0;
function check(label, condition, extra) {
  if (condition) {
    pass++;
    console.log(`  [PASS] ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${label}${extra ? " — " + extra : ""}`);
  }
}

function extractCookie(headers, name) {
  const all = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const c of all) {
    if (c.startsWith(name + "=")) return c.split(";")[0];
  }
  return null;
}

async function signup(username) {
  const csrfRes = await fetch(`${BASE}/api/csrf-token`);
  const csrfCookie = extractCookie(csrfRes.headers, "tsp.csrf");
  const csrfToken = (await csrfRes.json()).csrfToken;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, Cookie: csrfCookie },
    body: JSON.stringify({ username, password: "testpass123" }),
  });
  const sessionCookie = extractCookie(res.headers, "tsp.sid");
  const body = await res.json();
  if (res.status !== 201) throw new Error(`signup failed for ${username}: ${JSON.stringify(body)}`);
  return { cookie: `${csrfCookie}; ${sessionCookie}`, csrfToken, user: body.user };
}

async function login(username, password) {
  const csrfRes = await fetch(`${BASE}/api/csrf-token`);
  const csrfCookie = extractCookie(csrfRes.headers, "tsp.csrf");
  const csrfToken = (await csrfRes.json()).csrfToken;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, Cookie: csrfCookie },
    body: JSON.stringify({ username, password }),
  });
  const sessionCookie = extractCookie(res.headers, "tsp.sid");
  const body = await res.json();
  return { cookie: `${csrfCookie}; ${sessionCookie}`, csrfToken, user: body.user };
}

async function call(client, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": client.csrfToken, Cookie: client.cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json() : null;
  return { status: res.status, body: data };
}

async function getMe(client) {
  const res = await fetch(`${BASE}/api/users/me`, { headers: { Cookie: client.cookie } });
  return (await res.json()).user;
}

function transfer(client, receiverId, amount, idempotencyKey) {
  return call(client, "POST", "/api/wallet/transfer", { receiverId, amount, idempotencyKey });
}

async function edgeCase1_concurrentRace() {
  console.log("\n=== 1. 동시 송금 레이스 (잔액 10000에 6000+6000 동시 요청) ===");
  const suffix = Date.now().toString().slice(-6);
  const sender = await signup("ec1s_" + suffix);
  const receiver = await signup("ec1r_" + suffix);

  const [r1, r2] = await Promise.all([
    transfer(sender, receiver.user.id, 6000, `ec1-${suffix}-a`),
    transfer(sender, receiver.user.id, 6000, `ec1-${suffix}-b`),
  ]);

  const statuses = [r1.status, r2.status].sort();
  const senderFinal = await getMe(sender);
  const receiverFinal = await getMe(receiver);

  check("정확히 하나만 200, 하나는 409", statuses[0] === 200 && statuses[1] === 409, `statuses=${JSON.stringify([r1.status, r2.status])}`);
  check("송신자 최종 잔액 = 4000 (이중차감 없음)", senderFinal.balance === "4000", `실제=${senderFinal.balance}`);
  check("수신자 최종 잔액 = 16000 (정확히 한 번만 입금)", receiverFinal.balance === "16000", `실제=${receiverFinal.balance}`);
}

async function edgeCase2_overBalance() {
  console.log("\n=== 2. 잔액 초과 송금 거부 + 잔액 불변 (단건 + 동시 3건) ===");
  const suffix = Date.now().toString().slice(-6);
  const sender = await signup("ec2s_" + suffix);
  const receiver = await signup("ec2r_" + suffix);

  const before = await getMe(sender);
  const res = await transfer(sender, receiver.user.id, 999999, `ec2-${suffix}`);
  const after = await getMe(sender);

  check("보유 잔액 초과 송금은 409", res.status === 409, JSON.stringify(res.body));
  check("거부 후 잔액 불변", before.balance === after.balance, `before=${before.balance}, after=${after.balance}`);
  check("잔액이 음수가 아님", BigInt(after.balance) >= 0n);

  const results = await Promise.all(
    [1, 2, 3].map((i) => transfer(sender, receiver.user.id, 999999, `ec2-concurrent-${suffix}-${i}`))
  );
  const finalBalance = await getMe(sender);
  check("동시 과다송금 3건도 전부 거부", results.every((r) => r.status === 409), JSON.stringify(results.map((r) => r.status)));
  check("동시 과다송금 후에도 잔액 불변", finalBalance.balance === before.balance);
}

async function edgeCase3_selfTransfer() {
  console.log("\n=== 3. 자기 자신 송금 방지 ===");
  const suffix = Date.now().toString().slice(-6);
  const user = await signup("ec3_" + suffix);

  const before = await getMe(user);
  const res = await transfer(user, user.user.id, 100, `ec3-${suffix}`);
  const after = await getMe(user);

  check("자기 자신 송금은 400", res.status === 400, JSON.stringify(res.body));
  check("거부 후 잔액 불변", before.balance === after.balance);
}

async function edgeCase4_adminBypass() {
  console.log("\n=== 4. 일반 유저 세션으로 /api/admin/* 전부 403 ===");
  const suffix = Date.now().toString().slice(-6);
  const plain = await signup("ec4_" + suffix);
  const dummyId = "00000000-0000-4000-8000-000000000000";

  const attempts = [
    ["GET", "/api/admin/users"],
    ["PATCH", `/api/admin/users/${dummyId}/dormant`],
    ["PATCH", `/api/admin/users/${dummyId}/activate`],
    ["GET", "/api/admin/products"],
    ["DELETE", `/api/admin/products/${dummyId}`],
    ["PATCH", `/api/admin/products/${dummyId}/unblock`],
    ["GET", "/api/admin/reports"],
    ["PATCH", `/api/admin/reports/${dummyId}/resolve`],
    ["GET", "/api/admin/wallet/transactions"],
  ];

  for (const [method, urlPath] of attempts) {
    const res = await call(plain, method, urlPath);
    check(`${method} ${urlPath} → 403`, res.status === 403, `실제 status=${res.status}`);
  }

  if (ADMIN_USERNAME && ADMIN_PASSWORD) {
    const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
    const res = await call(admin, "GET", "/api/admin/users");
    check("대조군: 실제 관리자 세션은 200", res.status === 200 && admin.user.role === "admin", `status=${res.status}`);
  } else {
    console.log("  [SKIP] VERIFY_ADMIN_USERNAME/VERIFY_ADMIN_PASSWORD 미설정 — 관리자 대조군 확인 생략");
  }
}

async function main() {
  await edgeCase1_concurrentRace();
  await edgeCase2_overBalance();
  await edgeCase3_selfTransfer();
  await edgeCase4_adminBypass();

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFY SCRIPT CRASHED:", err);
  process.exit(1);
});
