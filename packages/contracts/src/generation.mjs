import { createWidget } from "./widgets.mjs";

const OUTPUT_TYPES = Object.freeze(["image", "video"]);
const ASPECT_RATIOS = Object.freeze(["1:1", "4:5", "9:16", "16:9"]);

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
    const personaId = requiredString(binding.personaId, `personaBindings[${index}].personaId`, 80);
    if (seen.has(personaId)) {
      throw new TypeError(`personaBindings contains duplicate personaId: ${personaId}`);
    }
    seen.add(personaId);

    return {
      personaId,
      role: requiredString(binding.role ?? "subject", `personaBindings[${index}].role`, 80),
      referenceStrength: numberBetween(
        binding.referenceStrength,
        `personaBindings[${index}].referenceStrength`,
        0.8,
      ),
      preserveFace: binding.preserveFace !== false,
      preserveWardrobe: binding.preserveWardrobe === true,
    };
  });

  const count = Number(input.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    throw new TypeError("count must be an integer between 1 and 12");
  }

  return {
    prompt: requiredString(input.prompt, "prompt"),
    negativePrompt:
      typeof input.negativePrompt === "string" && input.negativePrompt.trim()
        ? input.negativePrompt.trim().slice(0, 4_000)
        : null,
    outputType: enumValue(input.outputType ?? "image", "outputType", OUTPUT_TYPES),
    aspectRatio: enumValue(input.aspectRatio ?? "9:16", "aspectRatio", ASPECT_RATIOS),
    count,
    workflowId:
      typeof input.workflowId === "string" && input.workflowId.trim()
        ? input.workflowId.trim().slice(0, 120)
        : "persona-reference-v1",
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
      count: generation.input.count,
      workflowId: generation.input.workflowId,
      personas: generation.personaSnapshots.map((snapshot) => ({
        personaId: snapshot.personaId,
        displayName: snapshot.displayName,
        personaVersion: snapshot.personaVersion,
        referenceId: snapshot.reference.id,
        referenceSha256: snapshot.reference.sha256,
        role: snapshot.role,
        referenceStrength: snapshot.referenceStrength,
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
        input: { generationId: generation.id },
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
