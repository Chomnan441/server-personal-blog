import { Router } from "express";
import pool from "../utils/db.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";

const categoriesRouter = Router();

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

// GET /categories — รายการหมวดทั้งหมด (สาธารณะ ใช้ทั้งหน้าบ้านและ admin)
categoriesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name
       FROM categories
       ORDER BY name ASC`,
    );

    return res.status(200).json({
      categories: result.rows,
    });
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    return res.status(500).json({
      error: "Server could not read categories because database connection",
    });
  }
});

// GET /categories/:categoryId
categoriesRouter.get("/:categoryId", async (req, res) => {
  try {
    const { categoryId } = req.params;

    const result = await pool.query(
      `SELECT id, name
       FROM categories
       WHERE id = $1`,
      [categoryId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching category:", error.message);
    return res.status(500).json({
      error: "Server could not read category because database connection",
    });
  }
});

// POST /categories — สร้างหมวด (admin เท่านั้น)
categoriesRouter.post("/", protectAdmin, async (req, res) => {
  try {
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";

    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }

    const existing = await pool.query(
      `SELECT id FROM categories WHERE LOWER(name) = LOWER($1)`,
      [name],
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Category name already exists" });
    }

    const result = await pool.query(
      `INSERT INTO categories (name)
       VALUES ($1)
       RETURNING id, name`,
      [name],
    );

    return res.status(201).json({
      message: "Category created successfully",
      category: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating category:", error.message);
    return res.status(500).json({
      error: getErrorMessage(
        error,
        "Server could not create category because database connection",
      ),
    });
  }
});

// PUT /categories/:categoryId — แก้ชื่อหมวด (admin)
// โพสต์ที่ผูก category_id อยู่จะโชว์ชื่อใหม่เองผ่าน JOIN ไม่ต้องไล่แก้ posts
categoriesRouter.put("/:categoryId", protectAdmin, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim() : "";

    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }

    const current = await pool.query(
      `SELECT id, name FROM categories WHERE id = $1`,
      [categoryId],
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    const taken = await pool.query(
      `SELECT id FROM categories
       WHERE LOWER(name) = LOWER($1) AND id <> $2`,
      [name, categoryId],
    );

    if (taken.rows.length > 0) {
      return res.status(400).json({ error: "Category name already exists" });
    }

    const previousName = current.rows[0].name;

    const result = await pool.query(
      `UPDATE categories
       SET name = $1
       WHERE id = $2
       RETURNING id, name`,
      [name, categoryId],
    );

    return res.status(200).json({
      message: "Category updated successfully",
      category: result.rows[0],
      previousName,
    });
  } catch (error) {
    console.error("Error updating category:", error.message);
    return res.status(500).json({
      error: "Server could not update category because database connection",
    });
  }
});

// DELETE /categories/:categoryId — ลบหมวด (admin)
// ถ้ายังมีโพสต์ใช้อยู่ DB จะกันไว้ (foreign key) → ตอบ error ชัดๆ
categoriesRouter.delete("/:categoryId", protectAdmin, async (req, res) => {
  try {
    const { categoryId } = req.params;

    const inUse = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM posts
       WHERE category_id = $1`,
      [categoryId],
    );

    if (inUse.rows[0].count > 0) {
      return res.status(400).json({
        error:
          "Cannot delete category because it is still used by one or more posts",
      });
    }

    const result = await pool.query(
      `DELETE FROM categories
       WHERE id = $1
       RETURNING id`,
      [categoryId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.status(200).json({
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting category:", error.message);
    return res.status(500).json({
      error: "Server could not delete category because database connection",
    });
  }
});

export default categoriesRouter;
