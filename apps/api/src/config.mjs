import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, "../../..");
const DEV_MEDIA_SECRET = "development-media-secret-change-me";

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(repositoryRoot, env.HUB_DATA_DIR ?? "data");
  const port = positiveInteger(env.PORT, 3000);
  const publicOrigin = (env.HUB_PUBLIC_ORIGIN ?? `http://localhost:${port}`).replace(/\/$/, "");
  const requireContextHeaders = env.HUB_REQUIRE_CONTEXT_HEADERS === "true";
  const mediaSigningSecret = env.HUB_MEDIA_SIGNING_SECRET ?? DEV_MEDIA_SECRET;
  if (requireContextHeaders && mediaSigningSecret === DEV_MEDIA_SECRET) {
    throw new Error(
      "HUB_MEDIA_SIGNING_SECRET must be set when production context headers are required",
    );
  }
  const allowedOrigins = (env.HUB_ALLOWED_ORIGINS ?? publicOrigin)
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const generationMediaUrlTtlSeconds = positiveInteger(
    env.HUB_GENERATION_MEDIA_URL_TTL_SECONDS,
    1_800,
  );
  const mediaMaxUrlTtlSeconds = Math.max(
    generationMediaUrlTtlSeconds,
    positiveInteger(env.HUB_MEDIA_MAX_URL_TTL_SECONDS, 3_600),
  );

  return {
    repositoryRoot,
    port,
    dataDir,
    databaseFile: path.join(dataDir, "hub.json"),
    objectRoot: path.join(dataDir, "objects"),
    webRoot: path.join(repositoryRoot, "apps/web"),
    publicOrigin,
    allowedOrigins,
    requireContextHeaders,
    mediaSigningSecret,
    mediaUrlTtlSeconds: positiveInteger(env.HUB_MEDIA_URL_TTL_SECONDS, 300),
    generationMediaUrlTtlSeconds,
    mediaMaxUrlTtlSeconds,
    maxImageBytes: positiveInteger(env.HUB_MAX_IMAGE_BYTES, 15 * 1024 * 1024),
  };
}
