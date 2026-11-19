import pool from "./db.mjs";

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
