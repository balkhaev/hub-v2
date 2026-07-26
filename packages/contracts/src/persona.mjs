import { createWidget } from "./widgets.mjs";

export const PERSONA_SUBJECT_TYPES = Object.freeze([
  "fictional",
  "brand_character",
  "consenting_adult",
]);

export const PERSONA_CONSENT_STATUSES = Object.freeze([
  "not_required",
  "attested",
  "verified",
  "revoked",
]);

export const PERSONA_STATUSES = Object.freeze(["active", "archived"]);
export const PERSONA_REFERENCE_USAGES = Object.freeze([
  "identity",
  "appearance",
  "wardrobe",
  "pose",
  "style",
]);
export const PERSONA_MEDIA_SCOPES = Object.freeze(["image", "video"]);

const ALLOWED_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** @param {unknown} value @param {string} field @param {number} max */
function requiredString(value, field, max = 500) {
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
function optionalString(value, field, max = 2_000) {
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

/** @param {unknown} value @param {string} field */
function stringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new TypeError(`${field} must be an array with at most 30 entries`);
  }
  const normalized = value.map((item, index) =>
    requiredString(item, `${field}[${index}]`, 160),
  );
  return [...new Set(normalized)];
}

/** @param {unknown} value @param {string} field @param {readonly string[]} allowed */
function enumList(value, field, allowed) {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.length) {
    throw new TypeError(`${field} must be a non-empty array`);
  }
  const result = value.map((item, index) =>
    enumValue(item, `${field}[${index}]`, allowed),
  );
  return [...new Set(result)];
}

/** @param {unknown} value @param {string} field */
function optionalIsoDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = requiredString(value, field, 64);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${field} must be an ISO date`);
  return new Date(timestamp).toISOString();
}

/** @param {unknown} input */
function parseIdentityLocks(input) {
  const value = input && typeof input === "object" ? input : {};
  return {
    face: value.face !== false,
    hair: value.hair !== false,
    body: value.body === true,
    distinguishingMarks: value.distinguishingMarks !== false,
    voice: value.voice === true,
  };
}

/** @param {unknown} input */
export function parseSourceImage(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("sourceImage is required");
  }
  const contentType = enumValue(
    input.contentType,
    "sourceImage.contentType",
    ALLOWED_IMAGE_TYPES,
  );
  return {
    contentType,
    dataBase64: requiredString(input.dataBase64, "sourceImage.dataBase64", 30_000_000),
    fileName: optionalString(input.fileName, "sourceImage.fileName", 240),
    label: optionalString(input.label, "sourceImage.label", 120) ?? "Primary reference",
    notes: optionalString(input.notes, "sourceImage.notes", 1_000),
    usage: enumValue(
      input.usage ?? "identity",
      "sourceImage.usage",
      PERSONA_REFERENCE_USAGES,
    ),
  };
}

/** @param {unknown} input */
export function parseCreatePersona(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Request body must be an object");
  }

  const displayName = requiredString(input.displayName, "displayName", 120);
  const subjectType = enumValue(
    input.subjectType ?? "fictional",
    "subjectType",
    PERSONA_SUBJECT_TYPES,
  );
  const rawConsent = input.consent && typeof input.consent === "object" ? input.consent : {};
  const defaultConsentStatus = subjectType === "consenting_adult" ? "attested" : "not_required";
  const consentStatus = enumValue(
    rawConsent.status ?? defaultConsentStatus,
    "consent.status",
    PERSONA_CONSENT_STATUSES,
  );
  const ageConfirmed = rawConsent.ageConfirmed === true;
  const consentBasis = optionalString(rawConsent.basis, "consent.basis", 500);
  const attestedBy = optionalString(rawConsent.attestedBy, "consent.attestedBy", 120);
  const expiresAt = optionalIsoDate(rawConsent.expiresAt, "consent.expiresAt");
  const allowedMedia =
    subjectType === "consenting_adult"
      ? enumList(
          rawConsent.allowedMedia ?? ["image", "video"],
          "consent.allowedMedia",
          PERSONA_MEDIA_SCOPES,
        )
      : [...PERSONA_MEDIA_SCOPES];
  const commercialUse =
    subjectType === "consenting_adult" ? rawConsent.commercialUse === true : true;

  if (subjectType === "consenting_adult") {
    if (!ageConfirmed) {
      throw new TypeError("consent.ageConfirmed must be true for a real adult subject");
    }
    if (!consentBasis) {
      throw new TypeError("consent.basis is required for a real adult subject");
    }
    if (!attestedBy) {
      throw new TypeError("consent.attestedBy is required for a real adult subject");
    }
    if (consentStatus === "not_required" || consentStatus === "revoked") {
      throw new TypeError(
        "consent.status must be attested or verified for a new real adult subject",
      );
    }
  }

  return {
    displayName,
    subjectType,
    visualProfile: {
      description: optionalString(input.visualDescription, "visualDescription", 4_000),
      immutableTraits: stringList(input.immutableTraits, "immutableTraits"),
      variableTraits: stringList(input.variableTraits, "variableTraits"),
      negativeTraits: stringList(input.negativeTraits, "negativeTraits"),
      generationNotes: optionalString(input.generationNotes, "generationNotes", 2_000),
      identityLocks: parseIdentityLocks(input.identityLocks),
    },
    consent: {
      status: consentStatus,
      ageConfirmed,
      basis: consentBasis,
      attestedBy,
      allowedMedia,
      commercialUse,
      expiresAt,
    },
    sourceImage: parseSourceImage(input.sourceImage),
  };
}

/** @param {unknown} input */
export function parseAddPersonaReference(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("Request body must be an object");
  }
  return {
    sourceImage: parseSourceImage(input.sourceImage),
    setAsPrimary: input.setAsPrimary !== false,
    expectedPersonaVersion:
      input.expectedPersonaVersion === undefined
        ? null
        : (() => {
            const version = Number(input.expectedPersonaVersion);
            if (!Number.isInteger(version) || version < 1) {
              throw new TypeError("expectedPersonaVersion must be a positive integer");
            }
            return version;
          })(),
  };
}

/**
 * @param {Record<string, any>} persona
 * @param {Record<string, any>} reference
 * @param {string} imageUrl
 */
export function personaCardWidget(persona, reference, imageUrl) {
  return createWidget({
    type: "persona.card",
    entity: { kind: "persona", id: persona.id },
    snapshot: {
      displayName: persona.displayName,
      slug: persona.slug,
      subjectType: persona.subjectType,
      status: persona.status,
      version: persona.version,
      imageUrl,
      visualDescription: persona.visualProfile.description,
      immutableTraits: persona.visualProfile.immutableTraits,
      variableTraits: persona.visualProfile.variableTraits,
      negativeTraits: persona.visualProfile.negativeTraits,
      identityLocks: persona.visualProfile.identityLocks,
      consentStatus: persona.consent.status,
      consentScope: {
        allowedMedia: persona.consent.allowedMedia,
        commercialUse: persona.consent.commercialUse,
        expiresAt: persona.consent.expiresAt,
      },
      reference: {
        id: reference.id,
        version: reference.version,
        label: reference.label,
        usage: reference.usage,
        mediaType: reference.asset.mediaType,
        sha256: reference.asset.sha256,
      },
      referenceCount: persona.referenceIds.length,
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
    },
    actions: [
      {
        command: "generation.use_persona",
        label: "Use in generation",
        requiredRole: "content_editor",
        input: { personaId: persona.id, personaVersion: persona.version },
      },
      {
        command: "persona.add_reference",
        label: "Add reference",
        requiredRole: "content_editor",
        input: { personaId: persona.id, expectedPersonaVersion: persona.version },
      },
      {
        command: "persona.archive",
        label: "Archive",
        requiredRole: "content_approver",
        confirmation: true,
        input: { personaId: persona.id },
      },
    ],
  });
}
