import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { HttpError } from "../lib/HttpError";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "요청한 리소스를 찾을 수 없습니다." });
}

// Centralized error handler. Never forwards raw error messages/stacks to the
// client for unexpected errors — only HttpError (deliberately thrown with a
// safe message) and known validation errors are echoed back as-is.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "입력값이 올바르지 않습니다.",
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: "파일 업로드에 실패했습니다: " + err.code });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "이미 존재하는 값입니다." });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "요청한 리소스를 찾을 수 없습니다." });
      return;
    }
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }

  // Unexpected error: log server-side only, respond with a generic message
  // so no internal detail (stack traces, SQL, file paths) reaches the client.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err instanceof Error ? err.stack ?? err.message : err);
  res.status(500).json({ error: "서버 오류가 발생했습니다." });
}
