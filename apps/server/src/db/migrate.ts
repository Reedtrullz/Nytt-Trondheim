import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { buildDatabasePoolOptions } from "@nytt/shared";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migrations.");
}

const filename = fileURLToPath(import.meta.url);
const schemaPath = path.resolve(path.dirname(filename), "schema.sql");
const sql = await readFile(schemaPath, "utf8");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ...buildDatabasePoolOptions("migration"),
});
const migrationLockName = "nytt-trondheim:schema-migrations";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationLockName]);
  await client.query(sql);
  await client.query("COMMIT");
  console.log("Database schema applied with migration lock.");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    console.error("Database migration rollback failed.", rollbackError);
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
