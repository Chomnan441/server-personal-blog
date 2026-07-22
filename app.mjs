import express from "express";
import pool from "./db.mjs";

const app = express();
const port = process.env.PORT || 4000;

// GET /profiles
// ตาม API Document: ดึงโปรไฟล์ของ john จากฐานข้อมูล personal_blog
app.get("/profiles", async (req, res) => {
  try {
    // ดึงเฉพาะ name กับ age ของ john (ไม่ส่ง id ออกไป เพราะ Document ไม่ได้ใส่ id ใน response)
    // ถ้าชื่อตารางใน pgAdmin ไม่ใช่ "profiles" ให้แก้ชื่อตารางตรงนี้
    const result = await pool.query(
      "SELECT name, age FROM profiles WHERE name = $1",
      ["john"],
    );

    // ถ้าไม่เจอข้อมูล john
    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Profile not found",
      });
    }

    // รูปแบบ response ตาม API Document
    // { "data": { "name": "john", "age": 20 } }
    return res.status(200).json({
      data: {
        name: result.rows[0].name,
        age: result.rows[0].age,
      },
    });
  } catch (error) {
    console.error("Error fetching profile:", error.message);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
