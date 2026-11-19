import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const isVercel = Boolean(process.env.VERCEL);

// บน Vercel แนะนำใช้ Connection Pooler ของ Supabase (พอร์ต 6543)
// ไม่ใช่ Direct connection พอร์ต 5432 — serverless เชื่อมตรงมักพัง
const connectionPool = new Pool({
  connectionString: process.env.CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
  // Serverless: เปิด connection น้อย ปิดเร็ว กัน pool เต็ม
  max: isVercel ? 1 : 10,
  idleTimeoutMillis: isVercel ? 5000 : 30000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: isVercel,
});

connectionPool.on("error", (error) => {
  console.error("Unexpected PG pool error:", error.message);
});

export default connectionPool;
