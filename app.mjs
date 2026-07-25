import "dotenv/config";
import express from "express";
import cors from "cors";
import pool from "./db.mjs";

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

// GET /posts
// ดึงรายการบทความจาก Supabase
app.get("/posts", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         posts.id,
         posts.title,
         posts.image,
         posts.description,
         posts.content,
         posts.date,
         posts.likes_count,
         posts.category_id,
         categories.name AS category,
         posts.status_id,
         statuses.status
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       ORDER BY posts.id ASC`,
    );

    return res.status(200).json({
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching posts:", error.message);
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

// POST /posts
// ตาม API Document: นักเขียนสามารถสร้างบทความใหม่ขึ้นมาได้ในระบบ
app.post("/posts", async (req, res) => {
  try {
    const { title, image, category_id, description, content, status_id } =
      req.body;

    // ตรวจว่าข้อมูลที่จำเป็นครบหรือไม่
    if (
      !title ||
      !image ||
      category_id === undefined ||
      category_id === null ||
      !description ||
      !content ||
      status_id === undefined ||
      status_id === null
    ) {
      return res.status(400).json({
        message:
          "Server could not create post because there are missing data from client",
      });
    }

    await pool.query(
      `INSERT INTO posts (title, image, category_id, description, content, status_id, date, likes_count)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0)`,
      [title, image, category_id, description, content, status_id],
    );

    return res.status(201).json({
      message: "Created post successfully",
    });
  } catch (error) {
    console.error("Error creating post:", error.message);
    return res.status(500).json({
      message: "Server could not create post because database connection",
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
