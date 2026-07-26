import { randomUUID } from "node:crypto";

const ID_PATTERN = /^[a-z][a-z0-9]*_[a-f0-9]{32}$/;

/**
 * Generate a stable, URL-safe entity id with a human-readable prefix.
 * @param {string} prefix
 * @returns {string}
 */
export function createId(prefix) {
  if (!/^[a-z][a-z0-9]*$/.test(prefix)) {
    throw new TypeError(`Invalid id prefix: ${prefix}`);
  }

  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {string | undefined} expectedPrefix
 * @returns {string}
 */
export function requireId(value, field, expectedPrefix) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a valid entity id`);
  }

  if (expectedPrefix && !value.startsWith(`${expectedPrefix}_`)) {
    throw new TypeError(`${field} must use the ${expectedPrefix}_ prefix`);
  }

  return value;
}

/** @param {string} value */
export function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return slug || "persona";
}
