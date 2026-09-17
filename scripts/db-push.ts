// Applies supabase/schema.sql to the database: npm run db:push
// Re-runnable — schema.sql is written idempotently, so this is the one command to run
// after any schema edit. DDL has to go over a direct Postgres connection: supabase-js
// speaks to PostgREST, which exposes tables and functions but cannot create them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postgres from "postgres";

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  throw new Error(
    "Missing SUPABASE_DB_URL. Supabase > Project Settings > Database > Connection string > " +
      "Session pooler (port 5432). It contains your database password, so it belongs in " +
      ".env.local, never in .env.example.",
  );
}

// The transaction pooler multiplexes statements across backends and rejects most DDL.
if (connectionString.includes(":6543")) {
  throw new Error(
    "SUPABASE_DB_URL points at the transaction pooler (port 6543), which rejects DDL. " +
      "Use the session pooler on port 5432, or the direct connection.",
  );
}

const schemaPath = resolve(process.cwd(), "supabase/schema.sql");

// prepare: false because the pooler does not keep prepared statements across checkouts.
const sql = postgres(connectionString, { prepare: false, onnotice: () => {} });

async function main() {
  const schema = readFileSync(schemaPath, "utf-8");
  console.log(`Applying supabase/schema.sql (${schema.split("\n").length} lines)`);

  // Sent as one simple query rather than split on ';' — the stale-index `do $$ ... $$`
  // block contains semicolons of its own, and splitting would cut it in half. Postgres
  // runs a multi-statement simple query in a single implicit transaction, so a failure
  // anywhere leaves the schema untouched rather than half-applied.
  await sql.unsafe(schema);
  console.log("  schema applied");

  // PostgREST caches the schema and will answer PGRST205 ("not found in the schema cache")
  // for a table it has not been told about, even though the table exists.
  await sql`select pg_notify('pgrst', 'reload schema')`;
  console.log("  PostgREST schema cache reload signalled");

  // Report what is actually there, so a green run means a usable database.
  const [table] = await sql`
    select count(*)::int as n
    from information_schema.tables
    where table_schema = 'public' and table_name = 'recipes'
  `;
  const [fn] = await sql`
    select count(*)::int as n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'match_recipes'
  `;
  const [index] = await sql`
    select count(*)::int as n
    from pg_indexes
    where tablename = 'recipes' and indexname = 'recipes_embedding_hnsw_idx'
  `;
  const [rows] = await sql`select count(*)::int as n from recipes`;
  const [embedded] = await sql`select count(*)::int as n from recipes where embedding is not null`;

  console.log(
    `\n  recipes table          ${table.n ? "present" : "MISSING"}\n` +
      `  match_recipes function ${fn.n ? "present" : "MISSING"}\n` +
      `  HNSW index             ${index.n ? "present" : "MISSING"}\n` +
      `  rows                   ${rows.n} (${embedded.n} embedded)`,
  );

  if (!table.n || !fn.n || !index.n) {
    throw new Error("Schema applied but something is missing — see above.");
  }

  console.log(
    rows.n === 0
      ? "\nSchema is up to date. Next: npm run ingest"
      : "\nSchema is up to date.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
