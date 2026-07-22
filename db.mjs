import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// Pool = กลุ่มการเชื่อมต่อกับ PostgreSQL
// ใช้ค่าจากไฟล์ .env เพื่อไม่ต้องใส่รหัสผ่านในโค้ด
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

export default pool;
