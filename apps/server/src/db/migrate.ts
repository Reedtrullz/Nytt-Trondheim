import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migrations.");
}

const filename = fileURLToPath(import.meta.url);
const schemaPath = path.resolve(path.dirname(filename), "schema.sql");
const sql = await readFile(schemaPath, "utf8");
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log("Database schema applied.");
} finally {
  await pool.end();
}
