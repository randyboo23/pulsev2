import "server-only";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const globalForPool = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPool.pool ??
  new Pool({
    connectionString: databaseUrl,
    max: 5
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.pool = pool;
}
