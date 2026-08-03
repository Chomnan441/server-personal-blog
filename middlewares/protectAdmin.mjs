import { createClient } from "@supabase/supabase-js";
import connectionPool from "../utils/db.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// ตรวจ token + ตรวจว่า role เป็น admin
const protectAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    const supabaseUserId = data.user.id;

    const result = await connectionPool.query(
      `SELECT role FROM users WHERE id = $1`,
      [supabaseUserId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User role not found" });
    }

    req.user = { ...data.user, role: result.rows[0].role };

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: You do not have admin access" });
    }

    next();
  } catch (error) {
    console.error("protectAdmin error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default protectAdmin;
