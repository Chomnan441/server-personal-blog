import multer from "multer";

const MB = 1024 * 1024;

const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

function imageFileFilter(_req, file, cb) {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error("Only image files are allowed"), false);
}

function createImageUpload({ fields, fileSize }) {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
    limits: {
      fileSize,
      files: fields.length,
    },
  }).fields(fields);
}

export function createPostImageUpload() {
  return createImageUpload({
    fields: [{ name: "imageFile", maxCount: 1 }],
    fileSize: 5 * MB,
  });
}

export function createProfilePicUpload() {
  return createImageUpload({
    fields: [{ name: "profilePicFile", maxCount: 1 }],
    fileSize: 2 * MB,
  });
}

export function createHeroImageUpload() {
  return createImageUpload({
    fields: [
      { name: "heroImageFile", maxCount: 1 },
      { name: "heroImageHoverFile", maxCount: 1 },
    ],
    fileSize: 5 * MB,
  });
}

export function handleUploadError(err, req, res, next) {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large" });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "Invalid file upload" });
    }

    return res.status(400).json({ error: "Invalid file upload" });
  }

  if (err.message === "Only image files are allowed") {
    return res.status(400).json({ error: "Invalid file upload" });
  }

  next(err);
}
