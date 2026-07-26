import { requireId } from "./ids.mjs";
import { createWidget } from "./widgets.mjs";

export const SHORT_DRAMA_PLATFORMS = Object.freeze([
  "instagram_reels",
  "tiktok",
  "youtube_shorts",
  "x",
  "owned_media",
]);
export const SHORT_DRAMA_TONES = Object.freeze([
  "melodrama",
  "romantic",
  "thriller",
  "mystery",
  "comedy",
  "dark_comedy",
]);
export const CREATIVE_JOB_STATUSES = Object.freeze([
  "planning",
  "ready_for_generation",
  "generating",
  "evaluating",
  "ready_for_review",
  "completed",
  "failed",
  "cancelled",
]);
const USAGES = Object.freeze(["internal_concept", "organic_social", "paid_media", "owned_media"]);

function requiredString(value, field, max = 4_000) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${field} must be at most ${max} characters`);
  return normalized;
}
function optionalString(value, field, max = 4_000) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, max);
}
function enumValue(value, field, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
function integerBetween(value, field, fallback, min, max) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new TypeError(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}
function numberBetween(value, field, fallback, min, max) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new TypeError(`${field} must be a number between ${min} and ${max}`);
  }
  return number;
}
function stringList(value, field, maxEntries = 20, maxItem = 300) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new TypeError(`${field} must be an array with at most ${maxEntries} entries`);
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`, maxItem));
}
function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${field} must be a positive integer`);
  return number;
}

export function parseCreateShortDrama(input) {
  if (!input || typeof input !== "object") throw new TypeError("Request body must be an object");
  const platform = enumValue(input.platform ?? "instagram_reels", "platform", SHORT_DRAMA_PLATFORMS);
  const usage = enumValue(input.usage ?? "organic_social", "usage", USAGES);
  const rawCharacters = input.characters ?? [];
  if (!Array.isArray(rawCharacters) || rawCharacters.length > 4) {
    throw new TypeError("characters must be an array with at most four entries");
  }
  const seen = new Set();
  const characters = rawCharacters.map((character, index) => {
    if (!character || typeof character !== "object") throw new TypeError(`characters[${index}] must be an object`);
    const personaId = requireId(character.personaId, `characters[${index}].personaId`, "per");
    if (seen.has(personaId)) throw new TypeError(`characters contains duplicate personaId: ${personaId}`);
    seen.add(personaId);
    return {
      personaId,
      personaVersion: optionalPositiveInteger(character.personaVersion, `characters[${index}].personaVersion`),
      referenceId:
        character.referenceId === undefined || character.referenceId === null
          ? null
          : requireId(character.referenceId, `characters[${index}].referenceId`, "pref"),
      role: requiredString(character.role ?? (index === 0 ? "protagonist" : "supporting"), `characters[${index}].role`, 80),
      identityMode: enumValue(character.identityMode ?? "strict", `characters[${index}].identityMode`, ["strict", "balanced", "loose"]),
      referenceStrength: numberBetween(character.referenceStrength, `characters[${index}].referenceStrength`, 0.85, 0, 1),
      preserveWardrobe: character.preserveWardrobe === true,
    };
  });

  return {
    idempotencyKey: optionalString(input.idempotencyKey, "idempotencyKey", 160),
    title: optionalString(input.title, "title", 160),
    premise: requiredString(input.premise, "premise"),
    durationSeconds: integerBetween(input.durationSeconds, "durationSeconds", 45, 10, 180),
    platform,
    aspectRatio: enumValue(input.aspectRatio ?? "9:16", "aspectRatio", ["9:16", "1:1", "4:5", "16:9"]),
    language: optionalString(input.language, "language", 24) ?? "ru",
    tone: enumValue(input.tone ?? "melodrama", "tone", SHORT_DRAMA_TONES),
    targetAudience: optionalString(input.targetAudience, "targetAudience", 1_000),
    callToAction: optionalString(input.callToAction, "callToAction", 500),
    constraints: stringList(input.constraints, "constraints"),
    mustInclude: stringList(input.mustInclude, "mustInclude", 20, 200),
    mustAvoid: stringList(input.mustAvoid, "mustAvoid", 20, 200),
    characters,
    usage,
    variationCount: integerBetween(input.variationCount, "variationCount", 3, 2, 6),
    renderVariantsPerShot: integerBetween(input.renderVariantsPerShot, "renderVariantsPerShot", 2, 1, 4),
    maxIterations: integerBetween(input.maxIterations, "maxIterations", 3, 1, 5),
    qualityThreshold: numberBetween(input.qualityThreshold, "qualityThreshold", 0.86, 0.65, 0.98),
    autostart: input.autostart !== false,
  };
}

export function creativeJobWidget(job) {
  const best = job.bestVersion ?? null;
  return createWidget({
    type: "creative.short_drama",
    entity: { kind: "creative_job", id: job.id },
    snapshot: {
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      title: job.brief.title,
      premise: job.brief.premise,
      durationSeconds: job.brief.durationSeconds,
      platform: job.brief.platform,
      iterationCount: job.iterations.length,
      bestVersion: best
        ? {
            id: best.id,
            label: best.label,
            score: best.scorecard.total,
            thresholdMet: best.scorecard.total >= job.brief.qualityThreshold,
            logline: best.logline,
            shotCount: best.shotPlan.length,
            generationCount: best.generationIds.length,
          }
        : null,
      hubUrl: job.hubUrl,
      updatedAt: job.updatedAt,
    },
    actions: [
      {
        command: "creative.reconcile",
        label: "Refresh",
        requiredRole: "content_editor",
        input: { creativeJobId: job.id },
      },
      {
        command: "creative.request_refinement",
        label: "Refine",
        requiredRole: "content_editor",
        confirmation: true,
        input: { creativeJobId: job.id },
      },
    ],
  });
}
