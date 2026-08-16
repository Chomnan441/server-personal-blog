import { Router } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import pool from "../utils/db.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";
import protectUser from "../middlewares/protectUser.mjs";
import { notifyAdmins } from "../utils/notifications.mjs";

const postsRouter = Router();

// ใช้ service role สำหรับ Storage (อัปโหลด/ลบ) เพื่อไม่ติด RLS policy ของ anon
// ถ้ายังไม่มี SERVICE_ROLE_KEY จะ fallback เป็น ANON_KEY ชั่วคราว
const supabaseStorage = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
);

// anon client สำหรับตรวจ JWT บน GET สาธารณะ (ไม่บังคับ login)
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const multerStorage = multer.memoryStorage();
const upload = multer({ storage: multerStorage });
const imageFileUpload = upload.fields([{ name: "imageFile", maxCount: 1 }]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guest / user ธรรมดา → false (ไม่ 401)
 * Admin ที่ส่ง Bearer ถูกต้อง → true
 */
async function isAdminViewer(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return false;
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) {
      return false;
    }

    const result = await pool.query(`SELECT role FROM users WHERE id = $1`, [
      data.user.id,
    ]);

    return result.rows[0]?.role === "admin";
  } catch (error) {
    console.error("isAdminViewer error:", error.message);
    return false;
  }
}

/** DB เก็บ "publish" — UI/บางที่เรียก "published" */
function isPublishedStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return normalized === "publish" || normalized === "published";
}

// ตรวจ body ของ POST/PUT
// category_id ตรวจแค่มีค่า — จะ resolve เป็น id จริงจาก DB ทีหลัง (รองรับ uuid / ชื่อหมวด)
function validatePostBody(body = {}, { requireImage = true } = {}) {
  const fields = [
    { key: "title", label: "Title", type: "string" },
    { key: "category_id", label: "Category_id", type: "string" },
    { key: "description", label: "Description", type: "string" },
    { key: "content", label: "Content", type: "string" },
    { key: "status_id", label: "Status_id", type: "number" },
  ];

  if (requireImage) {
    fields.unshift({ key: "image", label: "Image", type: "string" });
  }

  for (const field of fields) {
    const value = body[field.key];

    if (
      value === undefined ||
      value === null ||
      (field.type === "string" && value === "")
    ) {
      return { ok: false, message: `${field.label} is required` };
    }

    if (typeof value !== field.type) {
      return {
        ok: false,
        message: `${field.label} must be a ${field.type}`,
      };
    }
  }

  return { ok: true };
}

/**
 * แปลงค่า category จาก FE ให้เป็น id จริงในตาราง categories
 * รับได้ทั้ง uuid, ชื่อหมวด ("General"), หรือเลข id แบบเก่า
 */
async function resolveCategoryId(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, message: "Category_id is required" };
  }

  const value = String(raw).trim();
  if (!value) {
    return { ok: false, message: "Category_id is required" };
  }

  if (UUID_RE.test(value)) {
    const result = await pool.query(`SELECT id FROM categories WHERE id = $1`, [
      value,
    ]);
    if (result.rows.length === 0) {
      return { ok: false, message: "Category not found" };
    }
    return { ok: true, id: result.rows[0].id };
  }

  const byName = await pool.query(
    `SELECT id FROM categories WHERE name ILIKE $1 LIMIT 1`,
    [value],
  );
  if (byName.rows.length > 0) {
    return { ok: true, id: byName.rows[0].id };
  }

  if (/^\d+$/.test(value)) {
    const byNumeric = await pool.query(
      `SELECT id FROM categories WHERE id::text = $1 LIMIT 1`,
      [value],
    );
    if (byNumeric.rows.length > 0) {
      return { ok: true, id: byNumeric.rows[0].id };
    }
  }

  return {
    ok: false,
    message: `Category not found: "${value}"`,
  };
}

// FormData ส่งทุกอย่างมาเป็น string — แปลงชนิดให้ถูกก่อน validate/insert
function parseMultipartPostBody(body = {}) {
  return {
    title: body.title,
    description: body.description,
    content: body.content,
    image: body.image,
    category_id:
      typeof body.category_id === "string"
        ? body.category_id.trim()
        : body.category_id,
    status_id: Number(body.status_id),
  };
}

const STORAGE_BUCKET = "personal-blog";

async function uploadImageToStorage(file) {
  const filePath = `posts/${Date.now()}_${file.originalname}`;

  const { data: uploadData, error: uploadError } = await supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: uploadError };
  }

  const {
    data: { publicUrl },
  } = supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(uploadData.path);

  return { ok: true, publicUrl };
}

/**
 * แปลง public URL ของ Supabase Storage → path ใน bucket
 * ตัวอย่าง:
 *   https://xxx.supabase.co/storage/v1/object/public/personal-blog/posts/123_a.jpg
 *   → posts/123_a.jpg
 * คืน null ถ้าไม่ใช่ URL ของ bucket นี้ (เช่น Unsplash)
 */
function getStoragePathFromPublicUrl(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") {
    return null;
  }

  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const rawPath = publicUrl.slice(index + marker.length).split("?")[0];
  if (!rawPath) {
    return null;
  }

  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * ลบไฟล์จาก Storage แบบ best-effort
 * ลบพลาด → log อย่างเดียว ไม่ทำให้ลบ/แก้โพสต์ล้ม
 */
async function deleteImageFromStorage(publicUrl) {
  const path = getStoragePathFromPublicUrl(publicUrl);
  if (!path) {
    console.warn(
      "Skip storage delete (not our bucket URL):",
      publicUrl?.slice?.(0, 80),
    );
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY is missing — storage delete may fail due to policies",
    );
  }

  const { data, error } = await supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .remove([path]);

  if (error) {
    console.error("Failed to delete image from storage:", path, error.message);
    return;
  }

  console.log("Deleted image from storage:", path, data);
}

// GET /posts/lookups — รายการ categories + statuses จาก DB (ใช้ map ชื่อ ↔ id)
// ต้องอยู่ก่อน /:postId ไม่งั้น Express จะคิดว่า "lookups" เป็น postId
postsRouter.get("/lookups", async (_req, res) => {
  try {
    const [categoriesResult, statusesResult] = await Promise.all([
      pool.query(`SELECT id, name FROM categories ORDER BY name ASC`),
      pool.query(`SELECT id, status FROM statuses ORDER BY id ASC`),
    ]);

    return res.status(200).json({
      categories: categoriesResult.rows,
      statuses: statusesResult.rows,
    });
  } catch (error) {
    console.error("Error fetching lookups:", error.message);
    return res.status(500).json({
      message: "Server could not read lookups because database connection",
    });
  }
});

// GET /posts
postsRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Number.parseInt(req.query.limit, 10) || 6);
    const category = req.query.category;
    const keyword = req.query.keyword;
    const isAdmin = await isAdminViewer(req);

    const conditions = [];
    const values = [];

    // public / user ธรรมดาเห็นเฉพาะ publish(ed) — admin (Bearer) เห็นทุกสถานะ
    // ตาราง statuses ใช้ค่า "publish" (ไม่ใช่ "published")
    if (!isAdmin) {
      conditions.push(
        `LOWER(statuses.status) IN ('publish', 'published')`,
      );
    }

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
       LEFT JOIN statuses ON posts.status_id = statuses.id
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
         posts.category_id,
         categories.name AS category,
         posts.title,
         posts.description,
         posts.date,
         posts.content,
         posts.status_id,
         statuses.status,
         posts.likes_count,
         posts.user_id,
         users.name AS author,
         users.profile_pic AS author_image,
         users.bio AS author_bio
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       LEFT JOIN users ON posts.user_id = users.id
       ${whereClause}
       ORDER BY posts.date DESC NULLS LAST, posts.id DESC
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
         posts.category_id,
         categories.name AS category,
         posts.title,
         posts.description,
         posts.date,
         posts.content,
         posts.status_id,
         statuses.status,
         posts.likes_count,
         posts.user_id,
         users.name AS author,
         users.profile_pic AS author_image,
         users.bio AS author_bio
       FROM posts
       LEFT JOIN categories ON posts.category_id = categories.id
       LEFT JOIN statuses ON posts.status_id = statuses.id
       LEFT JOIN users ON posts.user_id = users.id
       WHERE posts.id = $1`,
      [postId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    const post = result.rows[0];
    const isAdmin = await isAdminViewer(req);

    // draft ซ่อนจาก public — ตอบ 404 ไม่บอกว่าเป็น draft
    if (!isAdmin && !isPublishedStatus(post.status)) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    return res.status(200).json(post);
  } catch (error) {
    console.error("Error fetching post:", error.message);
    return res.status(500).json({
      message: "Server could not read post because database connection",
    });
  }
});

// GET /posts/:postId/comments — ต้องอยู่ก่อน /:postId ถ้ามีโอกาสชน
// (path คนละแบบกับ /:postId อยู่แล้ว แต่จัดไว้ชัดเจน)
postsRouter.get("/:postId/comments", async (req, res) => {
  try {
    const { postId } = req.params;

    const postExists = await pool.query(`SELECT id FROM posts WHERE id = $1`, [
      postId,
    ]);

    if (postExists.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    const result = await pool.query(
      `SELECT
         comments.id,
         comments.comment_text,
         comments.created_at,
         users.name,
         users.profile_pic AS image
       FROM comments
       LEFT JOIN users ON comments.user_id = users.id
       WHERE comments.post_id = $1
       ORDER BY comments.created_at DESC`,
      [postId],
    );

    // FE คาดหวังเป็น array ตรงๆ
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching comments:", error.message);
    return res.status(500).json({
      message: "Server could not read comments because database connection",
    });
  }
});

// POST /posts/:postId/comments — โพสต์คอมเมนต์ (ต้องล็อกอิน)
postsRouter.post("/:postId/comments", protectUser, async (req, res) => {
  try {
    const { postId } = req.params;
    const commentText =
      typeof req.body?.comment_text === "string"
        ? req.body.comment_text.trim()
        : "";

    if (!commentText) {
      return res.status(400).json({ message: "Comment text is required" });
    }

    const postExists = await pool.query(`SELECT id FROM posts WHERE id = $1`, [
      postId,
    ]);

    if (postExists.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    const userId = req.user.id;

    // ต้องมีแถวในตาราง users (สมัครผ่าน /auth/register แล้ว)
    const userExists = await pool.query(
      `SELECT id, name, profile_pic FROM users WHERE id = $1`,
      [userId],
    );

    if (userExists.rows.length === 0) {
      return res.status(404).json({
        message: "User profile not found. Please complete registration.",
      });
    }

    const insertResult = await pool.query(
      `INSERT INTO comments (post_id, user_id, comment_text)
       VALUES ($1, $2, $3)
       RETURNING id, comment_text, created_at`,
      [postId, userId, commentText],
    );

    const row = insertResult.rows[0];
    const profile = userExists.rows[0];

    // แจ้งเตือน admin ว่ามีคอมเมนต์ใหม่
    try {
      await notifyAdmins({
        actorId: userId,
        type: "comment",
        postId: Number(postId),
        commentId: row.id,
        message: commentText,
      });
    } catch (notifyError) {
      console.error("notifyAdmins (comment) error:", notifyError.message);
    }

    return res.status(201).json({
      id: row.id,
      comment_text: row.comment_text,
      created_at: row.created_at,
      name: profile.name,
      image: profile.profile_pic,
    });
  } catch (error) {
    console.error("Error creating comment:", error.message);
    return res.status(500).json({
      message: "Server could not create comment",
      error: error.message,
    });
  }
});

// POST /posts/:postId/likes — กดไลค์ / ยกเลิกไลค์ (ต้องล็อกอิน)
postsRouter.post("/:postId/likes", protectUser, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    const postExists = await pool.query(
      `SELECT id, likes_count FROM posts WHERE id = $1`,
      [postId],
    );

    if (postExists.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post",
      });
    }

    const existing = await pool.query(
      `SELECT id FROM likes WHERE post_id = $1 AND user_id = $2`,
      [postId, userId],
    );

    let liked;
    let likesCount = Number(postExists.rows[0].likes_count) || 0;

    if (existing.rows.length > 0) {
      // ยกเลิกไลค์
      await pool.query(`DELETE FROM likes WHERE id = $1`, [
        existing.rows[0].id,
      ]);
      likesCount = Math.max(0, likesCount - 1);
      liked = false;
    } else {
      await pool.query(
        `INSERT INTO likes (post_id, user_id, liked_at)
         VALUES ($1, $2, NOW())`,
        [postId, userId],
      );
      likesCount += 1;
      liked = true;

      try {
        await notifyAdmins({
          actorId: userId,
          type: "like",
          postId: Number(postId),
          message: "liked your article",
        });
      } catch (notifyError) {
        console.error("notifyAdmins (like) error:", notifyError.message);
      }
    }

    await pool.query(`UPDATE posts SET likes_count = $1 WHERE id = $2`, [
      likesCount,
      postId,
    ]);

    return res.status(200).json({
      liked,
      likes_count: likesCount,
    });
  } catch (error) {
    console.error("Error toggling like:", error.message);
    return res.status(500).json({
      message: "Server could not update like",
      error: error.message,
    });
  }
});

async function updatePost(req, res) {
  try {
    const { postId } = req.params;
    const file = req.files?.imageFile?.[0];

    // รองรับทั้ง JSON และ multipart (ตอนเปลี่ยนรูป)
    const body =
      file || req.is("multipart/form-data")
        ? parseMultipartPostBody(req.body)
        : {
            title: req.body.title,
            description: req.body.description,
            content: req.body.content,
            image: req.body.image,
            category_id:
              typeof req.body.category_id === "string"
                ? req.body.category_id.trim()
                : req.body.category_id,
            status_id: Number(req.body.status_id),
          };

    // เก็บ URL รูปเก่าไว้ — ถ้าอัปโหลดรูปใหม่จะลบไฟล์เก่าทีหลัง
    let previousImageUrl = null;
    // ถ้าผู้ใช้แค่แก้ข้อความเฉยๆ ไม่ได้แนบรูปใหม่มา ตัวแปร file จะไม่มีค่า บล็อก if นี้ก็จะถูกข้ามไป
    // สรุปภาพรวม: โค้ดท่อนนี้ทำหน้าที่เป็นเหมือนนักสืบที่คอยไปเช็คประวัติก่อนว่า โพสต์ที่จะแก้ไขเนี่ย มีรูปเดิมอยู่ไหม ถ้ามีก็จดชื่อรูปเดิมเอาไว้ (เพื่อที่พอบันทึกรูปใหม่ลงระบบเสร็จแล้ว จะได้เอาชื่อรูปเก่านี้ไปสั่งลบทิ้ง ไม่ให้ไฟล์ขยะตกค้างในระบบนั่นเองครับ)
    if (file) {
      const existing = await pool.query(
        `SELECT image FROM posts WHERE id = $1`,
        [postId],
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({
          message: "Server could not find a requested post to update",
        });
      }
      previousImageUrl = existing.rows[0].image;
    }

    let imageUrl = body.image;

    if (file) {
      const uploaded = await uploadImageToStorage(file);
      if (!uploaded.ok) {
        console.error("Supabase upload error:", uploaded.error.message);
        return res.status(500).json({
          message: "Failed to upload image to storage",
          error: uploaded.error.message,
        });
      }
      imageUrl = uploaded.publicUrl;
    }

    const payload = {
      title: body.title,
      image: imageUrl,
      category_id: body.category_id,
      description: body.description,
      content: body.content,
      status_id: body.status_id,
    };

    const validation = validatePostBody(payload, { requireImage: true });
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const resolvedCategory = await resolveCategoryId(payload.category_id);
    if (!resolvedCategory.ok) {
      return res.status(400).json({ message: resolvedCategory.message });
    }

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
      [
        payload.title,
        payload.image,
        resolvedCategory.id,
        payload.description,
        payload.content,
        payload.status_id,
        postId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post to update",
      });
    }

    // อัปเดตสำเร็จแล้ว และมีรูปใหม่คนละไฟล์ → ลบรูปเก่าใน Storage
    if (previousImageUrl && imageUrl && previousImageUrl !== imageUrl) {
      await deleteImageFromStorage(previousImageUrl);
    }

    return res.status(200).json({
      message: "Updated post successfully",
      image: imageUrl,
    });
  } catch (error) {
    console.error("Error updating post:", error.message);
    return res.status(500).json({
      message: "Server could not update post because database connection",
    });
  }
}

// PUT /posts/:postId — เฉพาะ admin (มี token + role admin)
postsRouter.put("/:postId", imageFileUpload, protectAdmin, updatePost);

// DELETE /posts/:postId — เฉพาะ admin
postsRouter.delete("/:postId", protectAdmin, async (req, res) => {
  try {
    const { postId } = req.params;

    // RETURNING image ด้วย เพื่อรู้ว่าต้องลบไฟล์ไหนใน Storage
    const result = await pool.query(
      `DELETE FROM posts
       WHERE id = $1
       RETURNING id, image`,
      [postId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Server could not find a requested post to delete",
      });
    }

    const deletedImage = result.rows[0].image;
    await deleteImageFromStorage(deletedImage);

    return res.status(200).json({
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

    const resolvedCategory = await resolveCategoryId(newPost.category_id);
    if (!resolvedCategory.ok) {
      return res.status(400).json({ message: resolvedCategory.message });
    }

    const uploaded = await uploadImageToStorage(file);
    if (!uploaded.ok) {
      console.error("Supabase upload error:", uploaded.error.message);
      return res.status(500).json({
        message: "Failed to upload image to storage",
        error: uploaded.error.message,
      });
    }

    const { title, description, content, status_id } = newPost;
    const authorId = req.user.id;

    await pool.query(
      `INSERT INTO posts (title, image, category_id, description, content, status_id, date, likes_count, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0, $7)`,
      [
        title,
        uploaded.publicUrl,
        resolvedCategory.id,
        description,
        content,
        status_id,
        authorId,
      ],
    );

    return res.status(201).json({
      message: "Created post successfully",
      image: uploaded.publicUrl,
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
