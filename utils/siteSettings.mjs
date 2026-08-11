import pool from "./db.mjs";

let ensured = false;

/**
 * ตารางตั้งค่าเว็บ (แถวเดียว id=1)
 * เก็บรูป Hero แยกจากโปรไฟล์แอดมิน
 */
export async function ensureSiteSettingsTable() {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      hero_image TEXT,
      hero_image_hover TEXT,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO site_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);

  ensured = true;
}

export async function getSiteSettings() {
  await ensureSiteSettingsTable();

  const result = await pool.query(
    `SELECT hero_image, hero_image_hover FROM site_settings WHERE id = 1`,
  );

  const row = result.rows[0] || {};
  return {
    heroImage: row.hero_image || null,
    heroImageHover: row.hero_image_hover || null,
  };
}
