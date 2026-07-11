import http from "http";
import { createApp } from "./app";
import { createSocketServer } from "./socket";
import { env } from "./env";
import { prisma } from "./prisma";
import { getOrCreateGlobalRoom } from "./services/chat.service";

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  await getOrCreateGlobalRoom();

  httpServer.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async () => {
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
