import { Router } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import pool from "../utils/db.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";

const postsRouter = Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });
const imageFileUpload = upload.fields([{ name: "imageFile", maxCount: 1 }]);

// ตรวจ body ของ POST/PUT ตามโจทย์ validation
// คืน { ok: true } หรือ { ok: false, message: "..." } แล้ว route จะตอบ 400
// requireImage=false เมื่ออัปโหลดไฟล์แล้วได้ URL จาก Storage แทน
function validatePostBody(body = {}, { requireImage = true } = {}) {
  const fields = [
    { key: "title", label: "Title", type: "string" },
    { key: "category_id", label: "Category_id", type: "number" },
    { key: "description", label: "Description", type: "string" },
    { key: "content", label: "Content", type: "string" },
    { key: "status_id", label: "Status_id", type: "number" },
  ];

  if (requireImage) {
    fields.unshift({ key: "image", label: "Image", type: "string" });
  }

  for (const field of fields) {
    const value = body[field.key];

    // ขาดค่า / null / string ว่าง → required
    if (
      value === undefined ||
      value === null ||
      (field.type === "string" && value === "")
    ) {
      return { ok: false, message: `${field.label} is required` };
    }

    // ชนิดข้อมูลไม่ตรง
    if (typeof value !== field.type) {
      return {
        ok: false,
        message: `${field.label} must be a ${field.type}`,
      };
    }
  }

  return { ok: true };
}

// FormData ส่งตัวเลขมาเป็น string — แปลงก่อน validate/insert
function parseMultipartPostBody(body = {}) {
  return {
    title: body.title,
    description: body.description,
    content: body.content,
    category_id: Number(body.category_id),
    status_id: Number(body.status_id),
  };
}

// GET /posts
// ตาม API Document: ดูบทความทั้งหมด + แบ่งหน้า / กรองหมวด / ค้นหาคำ
postsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Number.parseInt(req.query.limit, 10) || 6);
    const category = req.query.category;
    const keyword = req.query.keyword;

    const conditions = [];
    const values = [];

    if (category) {
      values.push(category);
      conditions.push(`categories.name ILIKE $${values.length}`);
    }

    if (keyword) {
      values.push(`%${keyword}%`);
      const i = values.length;
      conditions.push(
        `(posts.title ILIKE $${i} OR posts.description ILIKE $${i} OR posts.content ILIKE $${i})`,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       ${whereClause}`,
      values,
    );

    const totalPosts = countResult.rows[0].total;
    const totalPages = Math.ceil(totalPosts / limit) || 0;
    const offset = (page - 1) * limit;

    const dataValues = [...values, limit, offset];
    const limitPlaceholder = values.length + 1;
    const offsetPlaceholder = values.length + 2;

    const result = await pool.query(
      `SELECT
         posts.id,
         posts.image,
         categories.name AS category,
         posts.title,
         posts.description,
         posts.date,
         posts.content,
         statuses.status,
         posts.likes_count
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       ${whereClause}
       ORDER BY posts.id ASC
       LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`,
      dataValues,
    );

    const nextPage = page < totalPages ? page + 1 : null;

    return res.status(200).json({
      totalPosts,
      totalPages,
      currentPage: page,
      limit,
      posts: result.rows,
      nextPage,
    });
  } catch (error) {
    console.error("Error fetching posts:", error.message);
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

// GET /posts/:postId
postsRouter.get("/:postId", async (req, res) => {
  try {
    const { postId } = req.params;

    const result = await pool.query(
      `SELECT
         posts.id,
         posts.image,
         categories.name AS category,
         posts.title,
         posts.description,
         posts.date,
         posts.content,
         statuses.status,
         posts.likes_count
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       WHERE posts.id = $1`,
      [postId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching post:", error.message);
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

// PUT /posts/:postId
postsRouter.put("/:postId", async (req, res) => {
  try {
    const validation = validatePostBody(req.body);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const { postId } = req.params;
    const { title, image, category_id, description, content, status_id } =
      req.body;

    const result = await pool.query(
      `UPDATE posts
       SET title = $1,
           image = $2,
           category_id = $3,
           description = $4,
           content = $5,
           status_id = $6
       WHERE id = $7
       RETURNING id`,
      [title, image, category_id, description, content, status_id, postId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post to update",
      });
    }

    return res.status(200).json({
      message: "Updated post successfully",
    });
  } catch (error) {
    console.error("Error updating post:", error.message);
    return res.status(500).json({
      message: "Server could not update post because database connection",
    });
  }
});

// DELETE /posts/:postId
postsRouter.delete("/:postId", async (req, res) => {
  try {
    const { postId } = req.params;

    const result = await pool.query(
      `DELETE FROM posts
       WHERE id = $1
       RETURNING id`,
      [postId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post to delete",
      });
    }

    return res.status(201).json({
      message: "Deleted post successfully",
    });
  } catch (error) {
    console.error("Error deleting post:", error.message);
    return res.status(500).json({
      message: "Server could not delete post because database connection",
    });
  }
});

async function createPostWithUpload(req, res) {
  try {
    const file = req.files?.imageFile?.[0];
    if (!file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const newPost = parseMultipartPostBody(req.body);
    const validation = validatePostBody(newPost, { requireImage: false });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const bucketName = "personal-blog";
    const filePath = `posts/${Date.now()}_${file.originalname}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError.message);
      return res.status(500).json({
        message: "Failed to upload image to storage",
        error: uploadError.message,
      });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucketName).getPublicUrl(uploadData.path);

    const { title, category_id, description, content, status_id } = newPost;

    await pool.query(
      `INSERT INTO posts (title, image, category_id, description, content, status_id, date, likes_count)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0)`,
      [title, publicUrl, category_id, description, content, status_id],
    );

    return res.status(201).json({
      message: "Created post successfully",
      image: publicUrl,
    });
  } catch (error) {
    console.error("Error creating post:", error.message);
    return res.status(500).json({
      message: "Server could not create post because database connection",
    });
  }
}

// POST /posts — รับ multipart (imageFile) อัปโหลดไป Supabase Storage แล้วบันทึกโพสต์
postsRouter.post("/", imageFileUpload, protectAdmin, createPostWithUpload);

export default postsRouter;
