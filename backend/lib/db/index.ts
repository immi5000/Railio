import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let _sql: ReturnType<typeof postgres> | null = null;
let _drizzle: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  // prepare:false is required when connecting through Supabase's transaction pooler (port 6543).
  _sql = postgres(url, { prepare: false });
  return _sql;
}

export function getDb() {
  if (_drizzle) return _drizzle;
  _drizzle = drizzle(getSql(), { schema });
  return _drizzle;
}

export { schema };
