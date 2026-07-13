import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { HttpError } from "../lib/HttpError";
import { ALLOWED_MIME } from "./multer";
import { detectImageMime } from "./magicBytes";

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads", "products");

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

  try {
    await sharp(buffer)
      .rotate() // normalize orientation using EXIF before stripping it
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(outputPath);
  } catch (err) {
    // sharp throws a plain Error (not necessarily an HttpError) for both
    // "this isn't a real image despite passing the magic-byte check" and
    // "the native libvips binding itself is broken" (e.g. node_modules
    // copied from a different OS/arch instead of installed in place — see
    // checkSharpAvailable() below, run once at boot to catch this earlier).
    // Converting it here keeps this request path from ever leaking a raw
    // native-module stack trace and guarantees asyncHandler's caller gets a
    // normal HttpError instead of an arbitrary thrown value.
    // eslint-disable-next-line no-console
    console.error("Image processing failed:", err instanceof Error ? err.stack ?? err.message : err);
    throw new HttpError(422, "이미지 처리 중 오류가 발생했습니다. 다른 이미지를 사용하거나 다시 시도해주세요.");
  }

  return filename;
}

// Exercises sharp against a trivial synthetic 1x1 PNG at server boot. sharp
// ships prebuilt native (libvips) binaries per OS/architecture; the most
// common way this breaks in practice is node_modules being installed on one
// platform and then copied/shared onto another (e.g. a network drive shared
// between a Linux dev environment and a Windows machine) — in that case
// every image processing attempt fails, but only once someone actually
// uploads a photo, which is a confusing place to first discover it. This
// check surfaces that immediately in the startup log instead, without
// blocking the server from serving everything else that doesn't need sharp.
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export async function checkSharpAvailable(): Promise<void> {
  try {
    await sharp(ONE_BY_ONE_PNG).jpeg().toBuffer();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[startup] sharp self-check failed — product image uploads will not work until this is fixed. " +
        "This usually means the native binary doesn't match this machine's OS/architecture " +
        "(common when node_modules is copied or shared between different machines instead of freshly " +
        "installed here). Try: delete node_modules and package-lock.json, then run `npm install` on this " +
        "machine directly.",
      err instanceof Error ? err.message : err
    );
  }
}

export async function deleteProductImage(filename: string | null): Promise<void> {
  if (!filename) return;
  const safeName = path.basename(filename);
  await fs.unlink(path.join(UPLOAD_DIR, safeName)).catch(() => undefined);
}
