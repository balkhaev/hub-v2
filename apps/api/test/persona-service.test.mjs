import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalObjectStore } from "../src/object-store.mjs";
import { PersonaService } from "../src/persona-service.mjs";
import { MemoryHubRepository } from "../src/repositories.mjs";

const PNG_A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlY9Z8AAAAASUVORK5CYII=";

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hub-v2-test-"));
  const repository = new MemoryHubRepository();
  const objectStore = new LocalObjectStore({ rootDir: root, maxImageBytes: 1024 * 1024 });
  const clock = () => new Date("2026-07-26T12:00:00.000Z");
  const service = new PersonaService({
    repository,
    objectStore,
    publicOrigin: "http://localhost:3000",
    clock,
  });
  return { root, repository, objectStore, service };
}

test("creates a reusable persona card and immutable source reference", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await fixture.service.createPersona(
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

  assert.match(result.persona.id, /^per_/);
  assert.match(result.primaryReference.id, /^pref_/);
  assert.equal(result.widget.type, "persona.card");
  assert.equal(result.persona.primaryReferenceId, result.primaryReference.id);
  assert.equal(result.primaryReference.asset.sha256.length, 64);

  const storedPath = fixture.objectStore.resolve(result.primaryReference.asset.objectKey);
  const stat = await fs.stat(storedPath);
  assert.ok(stat.size > 0);
});

test("generation request snapshots persona and reference versions", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const created = await fixture.service.createPersona(
    "ws_demo",
    {
      displayName: "Mira",
      subjectType: "fictional",
      sourceImage: { contentType: "image/png", dataBase64: PNG_A },
    },
    "user_1",
  );

  const generation = await fixture.service.createGenerationRequest(
    "ws_demo",
    {
      prompt: "Mira entering a neon hotel lobby",
      outputType: "video",
      aspectRatio: "9:16",
      personaBindings: [{ personaId: created.persona.id, referenceStrength: 0.85 }],
    },
    "user_1",
  );

  const originalReferenceId = generation.generation.personaSnapshots[0].reference.id;
  await fixture.service.addReference(
    "ws_demo",
    created.persona.id,
    {
      setAsPrimary: true,
      sourceImage: { contentType: "image/png", dataBase64: PNG_B },
    },
    "user_1",
  );

  const persisted = await fixture.service.getGenerationRequest(
    "ws_demo",
    generation.generation.id,
  );
  assert.equal(persisted.generation.personaSnapshots[0].reference.id, originalReferenceId);
  assert.equal(persisted.generation.personaSnapshots[0].personaVersion, 1);

  const currentPersona = await fixture.service.getPersona("ws_demo", created.persona.id);
  assert.equal(currentPersona.persona.version, 2);
  assert.notEqual(currentPersona.persona.primaryReferenceId, originalReferenceId);
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
