import "dotenv/config";
import express from "express";
import cors from "cors";
import postsRouter from "./routes/posts.mjs";
import authRouter from "./routes/auth.mjs";
import categoriesRouter from "./routes/categories.mjs";
import notificationsRouter from "./routes/notifications.mjs";
import protectUser from "./middlewares/protectUser.mjs";
import protectAdmin from "./middlewares/protectAdmin.mjs";
import { ensureNotificationsTable } from "./utils/notifications.mjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

// อนุญาตให้ frontend คนละ origin เรียก API ได้
app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend local (Vite)
      "http://localhost:3000", // Frontend local (React อื่นๆ)
      "https://your-frontend.vercel.app", // แก้เป็น URL frontend จริงตอน deploy
    ],
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "OK" });
});

// ติดตั้ง posts router ที่ path /posts
// เช่น GET / ใน router = GET /posts ในแอปจริง
app.use("/posts", postsRouter);

// ติดตั้ง auth router ที่ path /auth
// เช่น POST /register ใน router = POST /auth/register
app.use("/auth", authRouter);

// ติดตั้ง categories router ที่ path /categories
app.use("/categories", categoriesRouter);

// ติดตั้ง notifications router ที่ path /notifications
app.use("/notifications", notificationsRouter);

// route ทดสอบ — ผู้ใช้ที่ล็อกอินแล้วเท่านั้น
app.get("/protected-route", protectUser, (req, res) => {
  res.status(200).json({
    message: "This is protected content",
    user: req.user,
  });
});

// route ทดสอบ — admin เท่านั้น
app.get("/admin-only", protectAdmin, (req, res) => {
  res.status(200).json({
    message: "This is admin-only content",
    admin: req.user,
  });
});

app.listen(port, async () => {
  try {
    await ensureNotificationsTable();
    console.log("Notifications table is ready");
  } catch (error) {
    console.error("Could not ensure notifications table:", error.message);
  }
  console.log(`Server is running at http://localhost:${port}`);
});
