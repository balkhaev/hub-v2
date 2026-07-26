import test from "node:test";
import assert from "node:assert/strict";
import {
  isWidgetEnvelope,
  parseCreatePersona,
  parseGenerationRequest,
  personaCardWidget,
} from "../../../packages/contracts/src/index.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("fictional persona needs only a source image", () => {
  const parsed = parseCreatePersona({
    displayName: "Mira",
    subjectType: "fictional",
    sourceImage: { contentType: "image/png", dataBase64: PNG },
  });

  assert.equal(parsed.displayName, "Mira");
  assert.equal(parsed.consent.status, "not_required");
  assert.equal(parsed.consent.ageConfirmed, false);
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
    },
    sourceImage: { contentType: "image/png", dataBase64: PNG },
  });
  assert.equal(parsed.consent.status, "attested");
});

test("generation bindings are unique and bounded", () => {
  assert.throws(
    () =>
      parseGenerationRequest({
        prompt: "portrait",
        personaBindings: [
          { personaId: "per_one" },
          { personaId: "per_one" },
        ],
      }),
    /duplicate personaId/,
  );
});

test("persona card uses the typed widget envelope", () => {
  const widget = personaCardWidget(
    {
      id: "per_0123456789abcdef0123456789abcdef",
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
      },
      consent: { status: "not_required" },
      referenceIds: ["pref_0123456789abcdef0123456789abcdef"],
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    },
    {
      id: "pref_0123456789abcdef0123456789abcdef",
      version: 1,
      label: "Primary reference",
      asset: { mediaType: "image/png", sha256: "abc" },
    },
    "http://localhost/media/reference.png",
  );

  assert.equal(widget.type, "persona.card");
  assert.equal(isWidgetEnvelope(widget), true);
});
