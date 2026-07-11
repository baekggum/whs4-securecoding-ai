import multer from "multer";
import path from "path";

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Buffer in memory only — nothing touches disk until the buffer has been
// verified by magic-byte sniffing and re-encoded by sharp
// (docs/architecture.md §6 "파일 업로드 검증").
export const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error("허용되지 않은 파일 형식입니다. jpg, png, webp만 업로드할 수 있습니다."));
      return;
    }
    cb(null, true);
  },
});

export { ALLOWED_MIME };
