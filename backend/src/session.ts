import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { env } from "./env";

const PgSession = connectPgSimple(session);

// Dedicated pool for the session store, separate from Prisma's connection
// pool. Table is auto-created on first run (createTableIfMissing).
const sessionPool = new Pool({ connectionString: env.DATABASE_URL });

export const sessionMiddleware = session({
  store: new PgSession({
    pool: sessionPool,
    tableName: "session",
    createTableIfMissing: true,
  }),
  name: env.SESSION_COOKIE_NAME,
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_MAX_AGE_MS,
  },
});
