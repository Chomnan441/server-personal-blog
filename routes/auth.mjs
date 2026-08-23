import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import connectionPool from "../utils/db.mjs";
import protectUser from "../middlewares/protectUser.mjs";
import { createProfilePicUpload } from "../utils/upload.mjs";
import {
  deleteImageFromStorage,
  uploadImageToStorage,
} from "../utils/storage.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const authRouter = Router();
const profilePicUpload = createProfilePicUpload();

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

// POST /auth/forgot-password — ส่งอีเมลรีเซ็ตรหัส (ไม่ต้อง login)
authRouter.post("/forgot-password", async (req, res) => {
  const email =
    typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${FRONTEND_URL}/auth/recovery`,
    });

    if (error) {
      console.error("Forgot password error:", error.message);
    }

    // ตอบข้อความกลาง ๆ เสมอ — ไม่บอกว่ามี/ไม่มีอีเมลในระบบ
    return res.status(200).json({
      message:
        "If an account exists for this email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/recovery-password — ตั้งรหัสใหม่จากลิงก์ในอีเมล
authRouter.post("/recovery-password", async (req, res) => {
  const { accessToken, refreshToken, password } = req.body;

  if (!accessToken || !refreshToken) {
    return res.status(401).json({ error: "Recovery session is missing" });
  }

  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password is required" });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: "Password must be at least 6 characters",
    });
  }

  try {
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );

    // Supabase ต้อง setSession ก่อน — แค่ Bearer header ไม่พอ (Auth session missing)
    const { error: sessionError } = await userClient.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      return res.status(400).json({ error: sessionError.message });
    }

    const { error: updateError } = await userClient.auth.updateUser({
      password,
    });

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Recovery password error:", error);
    return res.status(500).json({ error: "Internal server error" });
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

// PUT /auth/profile — แก้ชื่อ / username / bio + อัปโหลดรูป (multipart)
authRouter.put("/profile", protectUser, profilePicUpload, async (req, res) => {
  const { name, username, bio } = req.body;

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
    const userId = req.user.id;

    const taken = await connectionPool.query(
      `SELECT id FROM users WHERE username = $1 AND id <> $2`,
      [trimmedUsername, userId],
    );

    if (taken.rows.length > 0) {
      return res.status(400).json({ error: "This username is already taken" });
    }

    const currentResult = await connectionPool.query(
      `SELECT profile_pic FROM users WHERE id = $1`,
      [userId],
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const previousProfilePic = currentResult.rows[0].profile_pic;
    let nextProfilePic = previousProfilePic;

    const profileFile = req.files?.profilePicFile?.[0];
    if (profileFile) {
      // ตั้งชื่อให้ path เป็น avatars/{timestamp}_{userId}.jpg
      profileFile.originalname = `${userId}.jpg`;

      const uploaded = await uploadImageToStorage(profileFile, "avatars");
      if (!uploaded.ok) {
        console.error("Avatar upload error:", uploaded.error.message);
        return res.status(500).json({ error: "Failed to upload profile picture" });
      }

      if (previousProfilePic) {
        await deleteImageFromStorage(previousProfilePic);
      }

      nextProfilePic = uploaded.publicUrl;
    }

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

    const user = result.rows[0];

    return res.status(200).json({
      message: "Profile updated successfully",
      user: {
        id: req.user.id,
        email: req.user.email,
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
