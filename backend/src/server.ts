import http from "http";
import { createApp } from "./app";
import { createSocketServer } from "./socket";
import { env, FRONTEND_ORIGINS, COOKIE_SECURE_EFFECTIVE } from "./env";
import { prisma } from "./prisma";
import { getOrCreateGlobalRoom } from "./services/chat.service";
import { checkSharpAvailable } from "./upload/imageProcessor";

// unhandledRejection has no reason to leave the process in a corrupted
// state (no exception unwound through arbitrary native/DB call frames), so
// logging and continuing is safe here — every request-path promise is
// expected to be awaited inside asyncHandler (which forwards rejections to
// Express's error middleware) or explicitly .catch()'d; this only exists to
// catch anything that slips through that net (e.g. src/socket/index.ts's
// getOrCreateGlobalRoom() call on connect, fixed to .catch() alongside this
// handler being added — see REPORT.md §14).
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled promise rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  await getOrCreateGlobalRoom();
  await checkSharpAvailable();

  httpServer.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
    // eslint-disable-next-line no-console
    console.log(
      `[env] cookies: secure=${COOKIE_SECURE_EFFECTIVE} sameSite=lax; allowed frontend origin(s): ${FRONTEND_ORIGINS.join(", ")}`
    );
  });

  let shuttingDown = false;

  async function shutdown(exitCode: number) {
    if (shuttingDown) return;
    shuttingDown = true;

    // httpServer.close() only stops accepting new connections and waits
    // for in-flight requests to finish — it does not touch already-upgraded
    // WebSocket connections, and chat is this app's core feature, so
    // there's normally at least one open socket. Without closing io first,
    // the force-exit timer below would fire on nearly every crash instead
    // of being an exceptional fallback. io.close() disconnects all clients
    // immediately, so shutdown finishes as soon as any in-flight HTTP
    // requests drain rather than waiting out the full grace period.
    const forceExitTimer = setTimeout(() => process.exit(exitCode), 5000);
    forceExitTimer.unref();

    try {
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await prisma.$disconnect();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error during shutdown:", err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    }
  }

  // An uncaughtException means an exception unwound through frames Node
  // doesn't guarantee are in a consistent state afterward (mid-query DB
  // connections, partially-written state, etc.) — per Node's own guidance,
  // continuing to serve requests from that point risks corrupted behavior
  // that's worse than a clean, fast restart. So unlike unhandledRejection,
  // this exits deliberately (after finishing in-flight requests and closing
  // the DB pool cleanly) rather than trying to keep running. A process
  // supervisor must sit in front of this in any environment where staying
  // up matters — see README's deployment note (pm2 / Docker
  // `restart: unless-stopped` / systemd Restart=on-failure). A genuine
  // native-module crash (e.g. a segfault in a native addon) bypasses this
  // handler entirely and cannot be caught from JS at all regardless — see
  // checkSharpAvailable().
  process.on("uncaughtException", (err) => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception, shutting down:", err.stack ?? err.message);
    void shutdown(1);
  });

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
