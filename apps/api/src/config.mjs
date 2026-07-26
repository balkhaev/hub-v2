import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDir, "../../..");

/** @param {string | undefined} value @param {number} fallback */
function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(repositoryRoot, env.HUB_DATA_DIR ?? "data");
  const port = positiveInteger(env.PORT, 3000);

  return {
    repositoryRoot,
    port,
    dataDir,
    databaseFile: path.join(dataDir, "hub.json"),
    objectRoot: path.join(dataDir, "objects"),
    webRoot: path.join(repositoryRoot, "apps/web"),
    publicOrigin: (env.HUB_PUBLIC_ORIGIN ?? `http://localhost:${port}`).replace(/\/$/, ""),
    requireContextHeaders: env.HUB_REQUIRE_CONTEXT_HEADERS === "true",
    maxImageBytes: positiveInteger(env.HUB_MAX_IMAGE_BYTES, 15 * 1024 * 1024),
  };
}
