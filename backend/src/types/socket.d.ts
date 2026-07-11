import type { User } from "@prisma/client";

declare module "socket.io" {
  interface SocketData {
    user: User;
  }
}
