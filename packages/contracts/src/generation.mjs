import { requireId } from "./ids.mjs";
import { createWidget } from "./widgets.mjs";

export const GENERATION_OUTPUT_TYPES = Object.freeze(["image", "video"]);
export const GENERATION_ASPECT_RATIOS = Object.freeze(["1:1", "4:5", "9:16", "16:9"]);
export const GENERATION_USAGES = Object.freeze([
  "internal_concept",
  "organic_social",
  "paid_media",
  "owned_media",
]);

/** @param {unknown} value @param {string} field @param {number} max */
function requiredString(value, field, max = 4_000) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new TypeError(`${field} must be at most ${max} characters`);
  }
  return normalized;
}

/** @param {unknown} value @param {string} field @param {number} max */
function optionalString(value, field, max = 4_000) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, max);
}

/** @param {unknown} value @param {string} field @param {readonly string[]} allowed */
function enumValue(value, field, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

/** @param {unknown} value @param {string} field @param {number} fallback */
function numberBetween(value, field, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${field} must be a number between 0 and 1`);
  }
  return number;
}

/** @param {unknown} value @param {string} field */
function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return number;
}

/** @param {unknown} value */
function optionalSeed(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new TypeError("seed must be an integer between 0 and 4294967295");
  }
  return number;
}

/** @param {unknown} input */
export function parseGenerationRequest(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Request body must be an object");
  }
  if (!Array.isArray(input.personaBindings) || input.personaBindings.length === 0) {
    throw new TypeError("personaBindings must contain at least one persona");
  }
  if (input.personaBindings.length > 4) {
    throw new TypeError("personaBindings supports at most four personas per generation");
  }

  const seen = new Set();
  const personaBindings = input.personaBindings.map((binding, index) => {
    if (!binding || typeof binding !== "object") {
      throw new TypeError(`personaBindings[${index}] must be an object`);
    }
    const personaId = requireId(
      binding.personaId,
      `personaBindings[${index}].personaId`,
      "per",
    );
    if (seen.has(personaId)) {
      throw new TypeError(`personaBindings contains duplicate personaId: ${personaId}`);
    }
    seen.add(personaId);

    return {
      personaId,
      personaVersion: optionalPositiveInteger(
        binding.personaVersion,
        `personaBindings[${index}].personaVersion`,
      ),
      referenceId:
        binding.referenceId === undefined || binding.referenceId === null
          ? null
          : requireId(
              binding.referenceId,
              `personaBindings[${index}].referenceId`,
              "pref",
            ),
      role: requiredString(binding.role ?? "subject", `personaBindings[${index}].role`, 80),
      referenceStrength: numberBetween(
        binding.referenceStrength,
        `personaBindings[${index}].referenceStrength`,
        0.8,
      ),
      identityMode: enumValue(
        binding.identityMode ?? "balanced",
        `personaBindings[${index}].identityMode`,
        ["strict", "balanced", "loose"],
      ),
      preserveFace:
        binding.preserveFace === undefined ? null : binding.preserveFace !== false,
      preserveWardrobe: binding.preserveWardrobe === true,
    };
  });

  const count = Number(input.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new TypeError("count must be an integer between 1 and 12");
  }

  return {
    idempotencyKey: optionalString(input.idempotencyKey, "idempotencyKey", 160),
    prompt: requiredString(input.prompt, "prompt"),
    negativePrompt: optionalString(input.negativePrompt, "negativePrompt"),
    outputType: enumValue(
      input.outputType ?? "image",
      "outputType",
      GENERATION_OUTPUT_TYPES,
    ),
    aspectRatio: enumValue(
      input.aspectRatio ?? "9:16",
      "aspectRatio",
      GENERATION_ASPECT_RATIOS,
    ),
    usage: enumValue(input.usage ?? "internal_concept", "usage", GENERATION_USAGES),
    count,
    seed: optionalSeed(input.seed),
    workflowId: optionalString(input.workflowId, "workflowId", 120) ?? "persona-reference-v1",
    workflowVersion: optionalString(input.workflowVersion, "workflowVersion", 120) ?? "1",
    requestedModelId: optionalString(input.requestedModelId, "requestedModelId", 160),
    requestedModelVersion: optionalString(
      input.requestedModelVersion,
      "requestedModelVersion",
      160,
    ),
    personaBindings,
  };
}

/** @param {Record<string, any>} generation */
export function generationRequestWidget(generation) {
  return createWidget({
    type: "generation.request",
    entity: { kind: "generation_request", id: generation.id },
    snapshot: {
      status: generation.status,
      prompt: generation.input.prompt,
      outputType: generation.input.outputType,
      aspectRatio: generation.input.aspectRatio,
      usage: generation.input.usage,
      count: generation.input.count,
      seed: generation.input.seed,
      workflowId: generation.input.workflowId,
      workflowVersion: generation.input.workflowVersion,
      inputHash: generation.inputHash,
      personas: generation.personaSnapshots.map((snapshot) => ({
        personaId: snapshot.personaId,
        displayName: snapshot.displayName,
        personaVersion: snapshot.personaVersion,
        personaVersionId: snapshot.personaVersionId,
        referenceId: snapshot.reference.id,
        referenceSha256: snapshot.reference.sha256,
        role: snapshot.role,
        referenceStrength: snapshot.referenceStrength,
        identityMode: snapshot.identityMode,
      })),
      provider: generation.provider,
      createdAt: generation.createdAt,
    },
    actions: [
      {
        command: "generation.dispatch",
        label: "Send to Runpod",
        requiredRole: "content_editor",
        confirmation: true,
        input: { generationId: generation.id, inputHash: generation.inputHash },
      },
      {
        command: "generation.cancel",
        label: "Cancel",
        requiredRole: "content_editor",
        confirmation: true,
        input: { generationId: generation.id },
      },
    ],
  });
}
