import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors.mjs";

const PURPOSES = new Set(["preview", "generation"]);

/** @param {string} value */
function encoded(value) {
  return encodeURIComponent(value);
}

/** @param {string} value */
function signatureBuffer(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(403, "invalid_media_signature", "Media signature is invalid");
  }
  return Buffer.from(value, "hex");
}

export class MediaSigner {
  /**
   * @param {{secret: string, ttlSeconds?: number, maxTtlSeconds?: number, clock?: () => Date}} options
   */
  constructor({ secret, ttlSeconds = 300, maxTtlSeconds = 900, clock = () => new Date() }) {
    if (typeof secret !== "string" || secret.length < 24) {
      throw new TypeError("Media signing secret must be at least 24 characters");
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > maxTtlSeconds) {
      throw new TypeError("Media URL TTL is outside the supported range");
    }

    this.secret = secret;
    this.ttlSeconds = ttlSeconds;
    this.maxTtlSeconds = maxTtlSeconds;
    this.clock = clock;
  }

  /** @param {{workspaceId: string, referenceId: string, purpose?: string, ttlSeconds?: number}} input */
  issueReferenceUrl(input) {
    const purpose = input.purpose ?? "preview";
    if (!PURPOSES.has(purpose)) {
      throw new TypeError("Unsupported media URL purpose");
    }
    const ttlSeconds = input.ttlSeconds ?? this.ttlSeconds;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.maxTtlSeconds) {
      throw new TypeError("Media URL TTL is outside the supported range");
    }

    const expiresAt = Math.floor(this.clock().getTime() / 1000) + ttlSeconds;
    const signature = this.#sign(input.workspaceId, input.referenceId, purpose, expiresAt);
    return {
      expiresAt,
      purpose,
      signature,
      query: `workspace=${encoded(input.workspaceId)}&purpose=${encoded(purpose)}&expires=${expiresAt}&signature=${signature}`,
    };
  }

  /** @param {{workspaceId: string, referenceId: string, purpose: string, expiresAt: unknown, signature: unknown}} input */
  verifyReferenceUrl(input) {
    if (!PURPOSES.has(input.purpose)) {
      throw new HttpError(403, "invalid_media_purpose", "Media URL purpose is invalid");
    }
    const expiresAt = Number(input.expiresAt);
    const now = Math.floor(this.clock().getTime() / 1000);
    if (!Number.isInteger(expiresAt) || expiresAt < now) {
      throw new HttpError(403, "media_url_expired", "Media URL has expired");
    }
    if (expiresAt > now + this.maxTtlSeconds) {
      throw new HttpError(403, "invalid_media_expiry", "Media URL expiry is outside the allowed window");
    }
    if (typeof input.signature !== "string") {
      throw new HttpError(403, "invalid_media_signature", "Media signature is missing");
    }

    const expected = signatureBuffer(
      this.#sign(input.workspaceId, input.referenceId, input.purpose, expiresAt),
    );
    const actual = signatureBuffer(input.signature);
    if (!timingSafeEqual(expected, actual)) {
      throw new HttpError(403, "invalid_media_signature", "Media signature is invalid");
    }
  }

  #sign(workspaceId, referenceId, purpose, expiresAt) {
    return createHmac("sha256", this.secret)
      .update(`${workspaceId}\n${referenceId}\n${purpose}\n${expiresAt}`)
      .digest("hex");
  }
}
