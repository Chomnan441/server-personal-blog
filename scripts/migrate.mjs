import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

function createPool() {
  if (!process.env.CONNECTION_STRING) {
    throw new Error("CONNECTION_STRING is required to run migrations");
  }

  return new pg.Pool({
    connectionString: process.env.CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationNames(client) {
  const result = await client.query(
    `SELECT name FROM schema_migrations ORDER BY name ASC`,
  );
  return new Set(result.rows.map((row) => row.name));
}

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

async function applyMigration(client, fileName) {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await fs.readFile(filePath, "utf8");

  await client.query("BEGIN");

  try {
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [
      fileName,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrationNames(client);
    const files = await listMigrationFiles();

    if (files.length === 0) {
      console.log("No migration files found.");
      return;
    }

    let appliedCount = 0;

    for (const fileName of files) {
      if (applied.has(fileName)) {
        console.log(`Skipping ${fileName} (already applied)`);
        continue;
      }

      console.log(`Applying ${fileName}...`);
      await applyMigration(client, fileName);
      console.log(`Applied ${fileName}`);
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      console.log("Database is up to date.");
    } else {
      console.log(`Done. Applied ${appliedCount} migration(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
});
