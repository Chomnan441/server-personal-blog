import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import connectionPool from "../utils/db.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const authRouter = Router();

// POST /auth/register — สมัครสมาชิกผ่าน Supabase Auth + บันทึกโปรไฟล์ลงตาราง users
authRouter.post("/register", async (req, res) => {
  const { email, password, username, name } = req.body;

  try {
    const existingUser = await connectionPool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username],
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "This username is already taken" });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      if (error.code === "user_already_exists") {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }
      return res.status(400).json({
        error: "Failed to create user",
        message: error.message,
      });
    }

    const supabaseUserId = data.user.id;

    const result = await connectionPool.query(
      `INSERT INTO users (id, username, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [supabaseUserId, username, name, "user"],
    );

    return res.status(201).json({
      message: "User created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Register error:", error);
    return res
      .status(500)
      .json({ error: "An error occurred during registration" });
  }
});

// POST /auth/login — เข้าสู่ระบบด้วย email/password แล้วได้ access_token
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (
        error.code === "invalid_credentials" ||
        error.message.includes("Invalid login credentials")
      ) {
        return res.status(400).json({
          error: "Your password is incorrect or this email doesn't exist",
        });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({
      message: "Signed in successfully",
      access_token: data.session.access_token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "An error occurred during login" });
  }
});

// GET /auth/get-user — ดึงข้อมูลผู้ใช้ปัจจุบันจาก token + ตาราง users
authRouter.get("/get-user", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      return res.status(401).json({ error: "Unauthorized or token expired" });
    }

    const userResult = await connectionPool.query(
      `SELECT * FROM users WHERE id = $1`,
      [data.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const user = userResult.rows[0];

    return res.status(200).json({
      id: data.user.id,
      email: data.user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      profilePic: user.profile_pic,
    });
  } catch (error) {
    console.error("Get user error:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching user" });
  }
});

// PUT /auth/reset-password — เปลี่ยนรหัสผ่าน (ต้องยืนยันรหัสเก่า)
authRouter.put("/reset-password", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { oldPassword, newPassword } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  if (!newPassword) {
    return res.status(400).json({ error: "New password is required" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized or token expired" });
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: data.user.email,
      password: oldPassword,
    });

    if (loginError) {
      return res.status(400).json({ error: "Invalid old password" });
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default authRouter;
