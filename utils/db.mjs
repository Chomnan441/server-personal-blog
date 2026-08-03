import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// ต้องเปลี่ยน connectionString เป็นของตัวเองในไฟล์ .env
const connectionPool = new Pool({
  connectionString: process.env.CONNECTION_STRING,
  // Supabase บังคับใช้ SSL ตอนเชื่อมต่อจากภายนอก
  ssl: {
    rejectUnauthorized: false,
  },
});

export default connectionPool;
