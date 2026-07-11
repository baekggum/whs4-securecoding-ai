import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance for the process.
// Prisma's query API is parameterized by default, which is the app's primary
// SQL-injection defense; raw SQL is not used anywhere in this codebase.
export const prisma = new PrismaClient();
