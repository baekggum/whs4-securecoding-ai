import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { HttpError } from "../lib/HttpError";
import { ALLOWED_MIME } from "./multer";
import { detectImageMime } from "./magicBytes";

export const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads", "products");

// Client-reported extension/MIME (checked by multer's fileFilter) are only
// hints. Here we verify the actual file bytes (magic-byte sniff) and then
// re-encode with sharp — this strips EXIF metadata and neutralizes any
// polyglot payload hidden past the image data, since only decoded pixel
// data survives re-encoding. See docs/research.md §6.
export async function processAndStoreProductImage(buffer: Buffer): Promise<string> {
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
    throw new HttpError(400, "파일 내용이 이미지 형식과 일치하지 않습니다.");
  }

  const filename = `${crypto.randomUUID()}.jpg`;
  const outputPath = path.join(UPLOAD_DIR, filename);

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  await sharp(buffer)
    .rotate() // normalize orientation using EXIF before stripping it
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outputPath);

  return filename;
}

export async function deleteProductImage(filename: string | null): Promise<void> {
  if (!filename) return;
  const safeName = path.basename(filename);
  await fs.unlink(path.join(UPLOAD_DIR, safeName)).catch(() => undefined);
}
