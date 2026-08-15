import "dotenv/config";
import pg from "pg";
import { uploadImageToStorage } from "../utils/storage.mjs";

const pool = new pg.Pool({
  connectionString: process.env.CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

/**
 * แปลง data:image/...;base64,... → { buffer, mimetype, ext }
 */
function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }

  const mimetype = match[1].toLowerCase();
  const base64Part = match[2];

  let ext = "jpg";
  if (mimetype.includes("png")) ext = "png";
  else if (mimetype.includes("webp")) ext = "webp";
  else if (mimetype.includes("gif")) ext = "gif";
  else if (mimetype.includes("jpeg") || mimetype.includes("jpg")) ext = "jpg";

  try {
    const buffer = Buffer.from(base64Part, "base64");
    if (!buffer.length) {
      return null;
    }
    return { buffer, mimetype, ext };
  } catch {
    return null;
  }
}

try {
  if (!process.env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is missing");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY) is missing");
  }

  const result = await pool.query(
    `SELECT id, profile_pic
     FROM users
     WHERE profile_pic LIKE 'data:image%'`,
  );

  console.log(`Found ${result.rows.length} base64 avatar(s) to migrate`);

  let ok = 0;
  let failed = 0;

  for (const row of result.rows) {
    const decoded = decodeDataUrl(row.profile_pic);
    if (!decoded) {
      console.error(`Skip ${row.id}: could not decode data URL`);
      failed += 1;
      continue;
    }

    const file = {
      buffer: decoded.buffer,
      mimetype: decoded.mimetype,
      originalname: `${row.id}.${decoded.ext}`,
    };

    const uploaded = await uploadImageToStorage(file, "avatars");
    if (!uploaded.ok) {
      console.error(
        `Skip ${row.id}: upload failed —`,
        uploaded.error?.message || uploaded.error,
      );
      failed += 1;
      continue;
    }

    await pool.query(`UPDATE users SET profile_pic = $1 WHERE id = $2`, [
      uploaded.publicUrl,
      row.id,
    ]);

    console.log(`OK ${row.id} → ${uploaded.publicUrl}`);
    ok += 1;
  }

  console.log(`Done. success=${ok} failed=${failed}`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
