import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaSigner } from "../src/media-signer.mjs";
import { LocalObjectStore } from "../src/object-store.mjs";
import { PersonaService } from "../src/persona-service.mjs";
import { MemoryHubRepository } from "../src/repositories.mjs";

const PNG_A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlY9Z8AAAAASUVORK5CYII=";

async function createFixture(clockValue = "2026-07-26T12:00:00.000Z") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-v2-test-"));
  const repository = new MemoryHubRepository();
  const objectStore = new LocalObjectStore({
    rootDir: root,
    maxImageBytes: 1024 * 1024,
  });
  const clock = () => new Date(clockValue);
  const mediaSigner = new MediaSigner({
    secret: "test-media-signing-secret-long-enough",
    ttlSeconds: 300,
    clock,
  });
  const service = new PersonaService({
    repository,
    objectStore,
    mediaSigner,
    publicOrigin: "http://localhost:3000",
    clock,
    randomSeed: () => 42,
  });
  return { root, repository, objectStore, mediaSigner, service };
}

async function createMira(service) {
  return service.createPersona(
    "ws_demo",
    {
      displayName: "Mira",
      subjectType: "fictional",
      visualDescription: "Editorial heroine with a short dark bob",
      immutableTraits: ["green eyes", "heart-shaped face"],
      sourceImage: {
        contentType: "image/png",
        dataBase64: PNG_A,
        fileName: "mira.png",
      },
    },
    "user_1",
  );
}

test("creates a reusable persona card, immutable revision, and signed preview", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const result = await createMira(fixture.service);

  assert.match(result.persona.id, /^per_/);
  assert.match(result.primaryReference.id, /^pref_/);
  assert.equal(result.widget.type, "persona.card");
  assert.match(
    result.primaryReference.imageUrl,
    /^http:\/\/localhost:3000\/media\/references\//,
  );
  assert.equal(fixture.repository.state.personaVersions.length, 1);

  const storedPath = fixture.objectStore.resolve(result.primaryReference.asset.objectKey);
  assert.ok((await fs.stat(storedPath)).size > 0);
});

test("signed media URLs reject tenant or signature tampering", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const created = await createMira(fixture.service);
  const url = new URL(created.primaryReference.imageUrl);

  const asset = await fixture.service.resolveReferenceMedia({
    workspaceId: url.searchParams.get("workspace"),
    referenceId: created.primaryReference.id,
    purpose: url.searchParams.get("purpose"),
    expiresAt: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
  });
  assert.equal(asset.sha256, created.primaryReference.asset.sha256);

  await assert.rejects(
    () =>
      fixture.service.resolveReferenceMedia({
        workspaceId: "ws_other",
        referenceId: created.primaryReference.id,
        purpose: url.searchParams.get("purpose"),
        expiresAt: url.searchParams.get("expires"),
        signature: url.searchParams.get("signature"),
      }),
    /signature is invalid/,
  );
});

test("generation can pin an old persona version after a new primary reference", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const created = await createMira(fixture.service);
  const originalReferenceId = created.primaryReference.id;

  await fixture.service.addReference(
    "ws_demo",
    created.persona.id,
    {
      expectedPersonaVersion: 1,
      setAsPrimary: true,
      sourceImage: { contentType: "image/png", dataBase64: PNG_B },
    },
    "user_1",
  );

  const generation = await fixture.service.createGenerationRequest(
    "ws_demo",
    {
      idempotencyKey: "mira-old-version",
      prompt: "Mira entering a neon hotel lobby",
      outputType: "video",
      aspectRatio: "9:16",
      personaBindings: [
        {
          personaId: created.persona.id,
          personaVersion: 1,
          referenceId: originalReferenceId,
          referenceStrength: 0.85,
        },
      ],
    },
    "user_1",
  );

  assert.equal(generation.generation.personaSnapshots[0].personaVersion, 1);
  assert.equal(
    generation.generation.personaSnapshots[0].reference.id,
    originalReferenceId,
  );
  assert.ok(Number.isInteger(generation.generation.input.seed));
  assert.equal(generation.generation.requestHash.length, 64);
  assert.equal(generation.generation.personaSnapshots[0].reference.objectKey, undefined);
});

test("generation creation is idempotent and rejects key reuse with different input", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const created = await createMira(fixture.service);
  const request = {
    idempotencyKey: "campaign-42-mira-1",
    prompt: "Mira portrait",
    personaBindings: [{ personaId: created.persona.id }],
  };

  const first = await fixture.service.createGenerationRequest(
    "ws_demo",
    request,
    "user_1",
  );
  const second = await fixture.service.createGenerationRequest(
    "ws_demo",
    request,
    "user_1",
  );
  assert.equal(first.generation.id, second.generation.id);
  assert.equal(first.generation.input.seed, second.generation.input.seed);

  await assert.rejects(
    () =>
      fixture.service.createGenerationRequest(
        "ws_demo",
        { ...request, prompt: "A different prompt" },
        "user_1",
      ),
    /Idempotency key was already used/,
  );
});

test("adult consent scope blocks video or marketing use when not granted", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const created = await fixture.service.createPersona(
    "ws_demo",
    {
      displayName: "Alex",
      subjectType: "consenting_adult",
      consent: {
        status: "attested",
        ageConfirmed: true,
        basis: "Release 42",
        attestedBy: "producer",
        allowedMedia: ["image"],
        commercialUse: false,
      },
      sourceImage: { contentType: "image/png", dataBase64: PNG_A },
    },
    "user_1",
  );

  await assert.rejects(
    () =>
      fixture.service.createGenerationRequest(
        "ws_demo",
        {
          prompt: "video",
          outputType: "video",
          personaBindings: [{ personaId: created.persona.id }],
        },
        "user_1",
      ),
    /does not allow video/,
  );

  await assert.rejects(
    () =>
      fixture.service.createGenerationRequest(
        "ws_demo",
        {
          prompt: "social image",
          outputType: "image",
          usage: "organic_social",
          personaBindings: [{ personaId: created.persona.id }],
        },
        "user_1",
      ),
    /does not allow marketing use/,
  );
});

test("object store rejects a content-type mismatch", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    () =>
      fixture.objectStore.putImage({
        workspaceId: "ws_demo",
        contentType: "image/jpeg",
        dataBase64: PNG_A,
        fileName: "wrong.jpg",
      }),
    /File bytes do not match/,
  );
});
