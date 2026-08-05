import pool from "./db.mjs";

let ensured = false;

/**
 * สร้างตาราง notifications ถ้ายังไม่มี
 * (โปรเจกต์นี้ไม่มีไฟล์ migration — สร้างตอน server เริ่มทำงาน)
 */
export async function ensureNotificationsTable() {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      type VARCHAR(32) NOT NULL,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      message TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  ensured = true;
}

/**
 * สร้างแจ้งเตือนให้ admin ทุกคน
 * เช่น มีคนคอมเมนต์ / ไลค์บทความ
 */
export async function notifyAdmins({
  actorId,
  type,
  postId = null,
  commentId = null,
  message = null,
}) {
  await ensureNotificationsTable();

  await pool.query(
    `
    INSERT INTO notifications (recipient_id, actor_id, type, post_id, comment_id, message)
    SELECT u.id, $1, $2, $3, $4, $5
    FROM users u
    WHERE u.role = 'admin'
      AND u.id <> $1
    `,
    [actorId, type, postId, commentId, message],
  );
}
