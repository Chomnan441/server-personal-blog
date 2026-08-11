import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      hero_image TEXT,
      hero_image_hover TEXT,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO site_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  const check = await pool.query(`
    SELECT id, hero_image, hero_image_hover
    FROM site_settings
    WHERE id = 1
  `);
  console.log("site_settings:", check.rows[0]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
