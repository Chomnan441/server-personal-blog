import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// เชื่อมต่อ Supabase PostgreSQL ผ่าน CONNECTION_STRING จากไฟล์ .env
const pool = new Pool({
  connectionString: process.env.CONNECTION_STRING,
  // Supabase บังคับใช้ SSL ตอนเชื่อมต่อจากภายนอก
  ssl: {
    rejectUnauthorized: false,
  },
});

export default pool;
