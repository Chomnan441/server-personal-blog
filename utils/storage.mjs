import { createClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "personal-blog";

const supabaseStorage = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
);

/**
 * อัปโหลดไฟล์ไป Supabase Storage แล้วคืน public URL
 * @param {Express.Multer.File} file
 * @param {string} folder เช่น "hero" หรือ "posts"
 */
export async function uploadImageToStorage(file, folder = "posts") {
  const safeName = String(file.originalname || "image").replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  );
  const filePath = `${folder}/${Date.now()}_${safeName}`;

  const { data: uploadData, error: uploadError } = await supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadError) {
    return { ok: false, error: uploadError };
  }

  const {
    data: { publicUrl },
  } = supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(uploadData.path);

  return { ok: true, publicUrl };
}

function getStoragePathFromPublicUrl(publicUrl) {
  if (!publicUrl || typeof publicUrl !== "string") {
    return null;
  }

  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const rawPath = publicUrl.slice(index + marker.length).split("?")[0];
  if (!rawPath) {
    return null;
  }

  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

/** ลบไฟล์จาก Storage แบบ best-effort */
export async function deleteImageFromStorage(publicUrl) {
  const path = getStoragePathFromPublicUrl(publicUrl);
  if (!path) {
    return;
  }

  const { error } = await supabaseStorage.storage
    .from(STORAGE_BUCKET)
    .remove([path]);

  if (error) {
    console.error("Failed to delete image from storage:", path, error.message);
  }
}
