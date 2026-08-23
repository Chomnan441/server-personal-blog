import { Router } from "express";
import pool from "../utils/db.mjs";
import protectAdmin from "../middlewares/protectAdmin.mjs";
import { createHeroImageUpload } from "../utils/upload.mjs";
import {
  deleteImageFromStorage,
  uploadImageToStorage,
} from "../utils/storage.mjs";
import {
  ensureSiteSettingsTable,
  getSiteSettings,
} from "../utils/siteSettings.mjs";

const siteSettingsRouter = Router();

const heroImageUpload = createHeroImageUpload();

// GET /site-settings — สาธารณะ (หน้า Hero)
siteSettingsRouter.get("/", async (_req, res) => {
  try {
    const settings = await getSiteSettings();
    return res.status(200).json(settings);
  } catch (error) {
    console.error("Get site settings error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /site-settings — แอดมินอัปโหลดรูป Hero (ใบใดใบหนึ่งหรือทั้งคู่)
siteSettingsRouter.put(
  "/",
  protectAdmin,
  heroImageUpload,
  async (req, res) => {
    try {
      await ensureSiteSettingsTable();

      const current = await getSiteSettings();
      let nextHeroImage = current.heroImage;
      let nextHeroHover = current.heroImageHover;

      const heroFile = req.files?.heroImageFile?.[0];
      const hoverFile = req.files?.heroImageHoverFile?.[0];

      if (heroFile) {
        const uploaded = await uploadImageToStorage(heroFile, "hero");
        if (!uploaded.ok) {
          console.error("Hero image upload error:", uploaded.error.message);
          return res.status(500).json({
            error: "Failed to upload hero image",
          });
        }
        if (current.heroImage) {
          await deleteImageFromStorage(current.heroImage);
        }
        nextHeroImage = uploaded.publicUrl;
      }

      if (hoverFile) {
        const uploaded = await uploadImageToStorage(hoverFile, "hero");
        if (!uploaded.ok) {
          console.error("Hero hover upload error:", uploaded.error.message);
          return res.status(500).json({
            error: "Failed to upload hero hover image",
          });
        }
        if (current.heroImageHover) {
          await deleteImageFromStorage(current.heroImageHover);
        }
        nextHeroHover = uploaded.publicUrl;
      }

      // ปุ่ม "ใช้ค่าเริ่มต้น" ส่ง clearHeroImage / clearHeroImageHover เป็น "true"
      if (req.body?.clearHeroImage === "true" && !heroFile) {
        if (current.heroImage) {
          await deleteImageFromStorage(current.heroImage);
        }
        nextHeroImage = null;
      }

      if (req.body?.clearHeroImageHover === "true" && !hoverFile) {
        if (current.heroImageHover) {
          await deleteImageFromStorage(current.heroImageHover);
        }
        nextHeroHover = null;
      }

      await pool.query(
        `UPDATE site_settings
         SET hero_image = $1,
             hero_image_hover = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        [nextHeroImage, nextHeroHover],
      );

      return res.status(200).json({
        message: "Site settings updated",
        heroImage: nextHeroImage,
        heroImageHover: nextHeroHover,
      });
    } catch (error) {
      console.error("Update site settings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default siteSettingsRouter;
