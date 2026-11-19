import { Router } from "express";
import pool from "../utils/db.mjs";
import protectUser from "../middlewares/protectUser.mjs";
import { respondServerError } from "../utils/apiError.mjs";

const notificationsRouter = Router();

// ทุก route ต้องล็อกอิน
notificationsRouter.use(protectUser);

// GET /notifications — รายการแจ้งเตือนของ user ที่ล็อกอินอยู่
notificationsRouter.get("/", async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        n.id,
        n.type,
        n.message,
        n.is_read,
        n.created_at,
        n.post_id,
        n.comment_id,
        actor.name AS actor_name,
        actor.profile_pic AS actor_avatar,
        posts.title AS article_title,
        comments.comment_text
      FROM notifications n
      LEFT JOIN users actor ON n.actor_id = actor.id
      LEFT JOIN posts ON n.post_id = posts.id
      LEFT JOIN comments ON n.comment_id = comments.id
      WHERE n.recipient_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
      `,
      [userId],
    );

    return res.status(200).json({
      notifications: result.rows,
    });
  } catch (error) {
    return respondServerError(res, {
      logLabel: "Error fetching notifications",
      error,
      body: { error: "Server could not read notifications" },
    });
  }
});

// PUT /notifications/read-all — ทำเครื่องหมายว่าอ่านแล้วทั้งหมด
notificationsRouter.put("/read-all", async (req, res) => {
  try {
    const userId = req.user.id;

    await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE recipient_id = $1 AND is_read = FALSE
      `,
      [userId],
    );

    return res
      .status(200)
      .json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking notifications read:", error.message);
    return res.status(500).json({
      error: "Server could not update notifications",
    });
  }
});

export default notificationsRouter;
