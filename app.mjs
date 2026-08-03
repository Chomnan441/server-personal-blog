import "dotenv/config";
import express from "express";
import cors from "cors";
import postsRouter from "./routes/posts.mjs";

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

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
