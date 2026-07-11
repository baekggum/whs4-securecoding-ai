// A deliberately-thrown HTTP error with a client-safe message. The global
// error handler trusts this message to be safe to send to the client;
// anything else (unexpected exceptions) is logged and replaced with a
// generic message so internal details never leak in a response.
export class HttpError extends Error {
  status: number;
  // Optional machine-readable discriminator for callers that need to react
  // differently to specific failures (e.g. the frontend only retries a
  // request after refreshing its CSRF token when it sees "CSRF_INVALID",
  // instead of treating every 403 as a CSRF failure — see
  // frontend/src/api/client.ts).
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "HttpError";
  }
}
