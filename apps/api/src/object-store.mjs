import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors.mjs";

const EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

/** @param {string} value */
function safeSegment(value) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
  if (!normalized) {
    throw new HttpError(400, "invalid_object_key", "Object key segment is empty");
  }
  return normalized;
}

/** @param {string} value */
function decodeBase64(value) {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new HttpError(400, "invalid_image", "sourceImage.dataBase64 is not valid base64");
  }

  return Buffer.from(normalized, "base64");
}

/** @param {Buffer} bytes @param {string} contentType */
function assertImageSignature(bytes, contentType) {
  const valid =
    (contentType === "image/png" &&
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (contentType === "image/jpeg" &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (contentType === "image/webp" &&
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP");

  if (!valid) {
    throw new HttpError(400, "image_signature_mismatch", "File bytes do not match sourceImage.contentType");
  }
}

export class LocalObjectStore {
  /** @param {{rootDir: string, maxImageBytes: number}} options */
  constructor({ rootDir, maxImageBytes }) {
    this.rootDir = path.resolve(rootDir);
    this.maxImageBytes = maxImageBytes;
  }

  /**
   * @param {{workspaceId: string, contentType: string, dataBase64: string, fileName: string | null}} input
   */
  async putImage(input) {
    const extension = EXTENSIONS[input.contentType];
    if (!extension) {
      throw new HttpError(400, "unsupported_image_type", "Only JPEG, PNG, and WebP are supported");
    }

    const bytes = decodeBase64(input.dataBase64);
    if (bytes.length === 0) {
      throw new HttpError(400, "empty_image", "Source image is empty");
    }
    if (bytes.length > this.maxImageBytes) {
      throw new HttpError(
        413,
        "image_too_large",
        `Source image exceeds the ${this.maxImageBytes} byte limit`,
      );
    }
    assertImageSignature(bytes, input.contentType);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `${safeSegment(input.workspaceId)}/persona-references/${sha256.slice(0, 2)}/${sha256}.${extension}`;
    const absolutePath = path.resolve(this.rootDir, objectKey);

    if (!absolutePath.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new HttpError(400, "invalid_object_key", "Resolved object path is outside the store");
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await fs.writeFile(absolutePath, bytes, { flag: "wx" });
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }

    return {
      objectKey,
      mediaType: input.contentType,
      fileName: input.fileName,
      sizeBytes: bytes.length,
      sha256,
    };
  }

  /** @param {string} objectKey */
  resolve(objectKey) {
    const absolutePath = path.resolve(this.rootDir, objectKey);
    if (!absolutePath.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new HttpError(400, "invalid_object_key", "Invalid media path");
    }
    return absolutePath;
  }
}
