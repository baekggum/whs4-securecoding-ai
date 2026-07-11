// A deliberately-thrown HTTP error with a client-safe message. The global
// error handler trusts this message to be safe to send to the client;
// anything else (unexpected exceptions) is logged and replaced with a
// generic message so internal details never leak in a response.
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
