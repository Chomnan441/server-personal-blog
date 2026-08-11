import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

try {
  await pool.query(`
    ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);

  // โพสต์เก่าที่ยังไม่มีเจ้าของ → ผูกกับ admin คนแรก (ถ้ามี)
  await pool.query(`
    UPDATE posts
    SET user_id = (
      SELECT id FROM users WHERE role = 'admin' ORDER BY username ASC LIMIT 1
    )
    WHERE user_id IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  `);

  const check = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'user_id'
  `);

  console.log("user_id column:", check.rows[0]);

  const counts = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(user_id)::int AS with_author
    FROM posts
  `);
  console.log("posts author fill:", counts.rows[0]);
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
