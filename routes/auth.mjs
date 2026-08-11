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
      console.error("Supabase signUp error:", error.code, error.message);

      if (
        error.code === "user_already_exists" ||
        error.message?.toLowerCase().includes("already registered") ||
        error.message?.toLowerCase().includes("already been registered")
      ) {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }

      // ส่งข้อความจาก Supabase ตรงๆ ให้ FE แสดงได้ (เช่น รหัสสั้นเกินไป)
      return res.status(400).json({
        error: error.message || "Failed to create user",
      });
    }

    // บางโปรเจกต์เปิด Confirm email → data.user อาจมี แต่ยัง login ไม่ได้
    if (!data?.user?.id) {
      return res.status(400).json({
        error:
          "Sign up almost succeeded, but no user was returned. Check Supabase Auth email confirmation settings.",
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

// GET /auth/site-author — โปรไฟล์สาธารณะของแอดมินคนแรก (หน้า Hero)
authRouter.get("/site-author", async (_req, res) => {
  try {
    const result = await connectionPool.query(
      `SELECT name, bio, profile_pic
       FROM users
       WHERE role = 'admin'
       ORDER BY username ASC
       LIMIT 1`,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Site author not found" });
    }

    const author = result.rows[0];

    return res.status(200).json({
      name: author.name || "",
      bio: author.bio || "",
      profilePic: author.profile_pic || "",
    });
  } catch (error) {
    console.error("Site author error:", error);
    return res.status(500).json({ error: "Internal server error" });
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
      bio: user.bio || "",
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

    // ยืนยันรหัสเก่าด้วยการ login อีกรอบ
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: data.user.email,
      password: oldPassword,
    });

    if (loginError) {
      return res.status(400).json({ error: "Invalid old password" });
    }

    // อัปเดตรหัสด้วย client ที่ผูก token ของ user คนนี้
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    );

    const { error: updateError } = await userClient.auth.updateUser({
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

// PUT /auth/profile — แก้ชื่อ / username / รูปโปรไฟล์ / bio (ต้องมี token)
authRouter.put("/profile", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { name, username, profilePic, bio } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedUsername = typeof username === "string" ? username.trim() : "";
  const trimmedBio = typeof bio === "string" ? bio.trim() : "";

  if (!trimmedName) {
    return res.status(400).json({ error: "Name is required" });
  }

  if (!trimmedUsername) {
    return res.status(400).json({ error: "Username is required" });
  }

  if (trimmedBio.length > 120) {
    return res.status(400).json({ error: "Bio must be at most 120 characters" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized or token expired" });
    }

    const userId = data.user.id;

    const taken = await connectionPool.query(
      `SELECT id FROM users WHERE username = $1 AND id <> $2`,
      [trimmedUsername, userId],
    );

    if (taken.rows.length > 0) {
      return res.status(400).json({ error: "This username is already taken" });
    }

    const nextProfilePic =
      typeof profilePic === "string" && profilePic.trim()
        ? profilePic.trim()
        : null;

    const result = await connectionPool.query(
      `UPDATE users
       SET name = $1,
           username = $2,
           profile_pic = $3,
           bio = $4
       WHERE id = $5
       RETURNING *`,
      [trimmedName, trimmedUsername, nextProfilePic, trimmedBio, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const user = result.rows[0];

    return res.status(200).json({
      message: "Profile updated successfully",
      user: {
        id: data.user.id,
        email: data.user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        profilePic: user.profile_pic,
        bio: user.bio || "",
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default authRouter;
