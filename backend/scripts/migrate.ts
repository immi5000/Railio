import "dotenv/config";
// Local scripts use the direct connection (5432) to avoid the pooler's statement timeout.
if (process.env.DATABASE_URL_DIRECT) process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT;
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getSql, getDb } from "../lib/db";

(async () => {
  const sql = getSql();
  // pgvector must exist before any migration creates a `vector` column.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  // HNSW index for fast L2 nearest-neighbor on the corpus embedding.
  // Idempotent; safe to run on every migrate.
  await sql`CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_hnsw
            ON corpus_chunks USING hnsw (embedding vector_l2_ops)`;
  console.log("migrate: ok");
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
