// Operator-run only — deliberately not exposed as an HTTP endpoint. The
// signup API can never set role, and there is no "promote to admin" route;
// this script (run directly against the DB by whoever has server/deploy
// access) is the only way an account becomes an admin
// (docs/architecture.md §9.1).
//
// Usage: npm run admin:promote -- <username>
import { prisma } from "../src/prisma";

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: npm run admin:promote -- <username>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No user found with username "${username}".`);
    process.exit(1);
  }

  if (user.role === "admin") {
    console.log(`"${username}" is already an admin.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
  console.log(`"${username}" promoted to admin.`);
}

main()
  .catch((err) => {
    console.error("Failed to promote user:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
