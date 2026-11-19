import pool from "./db.mjs";

/**
 * ตารางตั้งค่าเว็บ (แถวเดียว id=1)
 * เก็บรูป Hero แยกจากโปรไฟล์แอดมิน
 */
export async function getSiteSettings() {
  const result = await pool.query(
    `SELECT hero_image, hero_image_hover FROM site_settings WHERE id = 1`,
  );

  const row = result.rows[0] || {};
  return {
    heroImage: row.hero_image || null,
    heroImageHover: row.hero_image_hover || null,
  };
}
