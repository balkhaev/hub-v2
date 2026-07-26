import test from "node:test";
import assert from "node:assert/strict";
import {
  isWidgetEnvelope,
  parseCreatePersona,
  parseGenerationRequest,
  personaCardWidget,
} from "../../../packages/contracts/src/index.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PERSONA_ID = "per_0123456789abcdef0123456789abcdef";
const REFERENCE_ID = "pref_0123456789abcdef0123456789abcdef";

test("fictional persona gets unrestricted media scope and identity locks", () => {
  const parsed = parseCreatePersona({
    displayName: "Mira",
    subjectType: "fictional",
    sourceImage: { contentType: "image/png", dataBase64: PNG },
  });

  assert.equal(parsed.consent.status, "not_required");
  assert.deepEqual(parsed.consent.allowedMedia, ["image", "video"]);
  assert.equal(parsed.consent.commercialUse, true);
  assert.equal(parsed.visualProfile.identityLocks.face, true);
});

test("real adult persona requires age and consent attestation", () => {
  assert.throws(
    () =>
      parseCreatePersona({
        displayName: "Alex",
        subjectType: "consenting_adult",
        sourceImage: { contentType: "image/png", dataBase64: PNG },
      }),
    /ageConfirmed/,
  );

  const parsed = parseCreatePersona({
    displayName: "Alex",
    subjectType: "consenting_adult",
    consent: {
      status: "attested",
      ageConfirmed: true,
      basis: "Signed model release 42",
      attestedBy: "producer@luv.club",
      allowedMedia: ["image"],
      commercialUse: true,
      expiresAt: "2027-01-01T00:00:00Z",
    },
    sourceImage: { contentType: "image/png", dataBase64: PNG },
  });
  assert.deepEqual(parsed.consent.allowedMedia, ["image"]);
  assert.equal(parsed.consent.commercialUse, true);
});

test("generation bindings select immutable persona and reference versions", () => {
  const parsed = parseGenerationRequest({
    idempotencyKey: "generation-mira-001",
    prompt: "portrait",
    usage: "organic_social",
    seed: 42,
    personaBindings: [
      {
        personaId: PERSONA_ID,
        personaVersion: 2,
        referenceId: REFERENCE_ID,
        identityMode: "strict",
      },
    ],
  });

  assert.equal(parsed.personaBindings[0].personaVersion, 2);
  assert.equal(parsed.personaBindings[0].referenceId, REFERENCE_ID);
  assert.equal(parsed.usage, "organic_social");
  assert.equal(parsed.seed, 42);
});

test("generation bindings are unique and bounded", () => {
  assert.throws(
    () =>
      parseGenerationRequest({
        prompt: "portrait",
        personaBindings: [
          { personaId: PERSONA_ID },
          { personaId: PERSONA_ID },
        ],
      }),
    /duplicate personaId/,
  );
});

test("persona card uses the typed widget envelope", () => {
  const widget = personaCardWidget(
    {
      id: PERSONA_ID,
      displayName: "Mira",
      slug: "mira",
      subjectType: "fictional",
      status: "active",
      version: 1,
      visualProfile: {
        description: null,
        immutableTraits: [],
        variableTraits: [],
        negativeTraits: [],
        generationNotes: null,
        identityLocks: {
          face: true,
          hair: true,
          body: false,
          distinguishingMarks: true,
          voice: false,
        },
      },
      consent: {
        status: "not_required",
        allowedMedia: ["image", "video"],
        commercialUse: true,
        expiresAt: null,
      },
      referenceIds: [REFERENCE_ID],
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    },
    {
      id: REFERENCE_ID,
      version: 1,
      usage: "identity",
      label: "Primary reference",
      asset: { mediaType: "image/png", sha256: "abc" },
    },
    "http://localhost/media/reference.png",
  );

  assert.equal(widget.type, "persona.card");
  assert.equal(isWidgetEnvelope(widget), true);
  assert.equal(widget.actions[0].input.personaVersion, 1);
});
