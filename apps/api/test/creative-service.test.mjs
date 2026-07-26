import test from "node:test";
import assert from "node:assert/strict";
import { CreativeService, selectBestProviderOutput } from "../src/creative-service.mjs";
import { MemoryHubRepository } from "../src/repositories.mjs";

const PERSONA = "per_0123456789abcdef0123456789abcdef";

function fixture({ dispatcher = null } = {}) {
  const repository = new MemoryHubRepository();
  const generations = [];
  const personaService = {
    async createGenerationRequest(workspaceId, input, actorId) {
      const generation = {
        id: `gen_${String(generations.length + 1).padStart(32, "0")}`,
        workspaceId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.idempotencyKey,
        status: "ready_for_dispatch",
        input,
        actorId,
      };
      generations.push(generation);
      await repository.createGeneration(generation);
      return { generation };
    },
  };
  const service = new CreativeService({
    repository,
    personaService,
    generationDispatcher: dispatcher,
    publicOrigin: "http://localhost:3000",
    clock: () => new Date("2026-07-26T16:00:00.000Z"),
  });
  return { repository, generations, service };
}

test("creates ideal production package and shot generations", async () => {
  const { repository, generations, service } = fixture();
  const result = await service.createShortDrama("ws_demo", {
    idempotencyKey: "drama-42",
    premise: "После расставания он находит голосовое сообщение, записанное год назад",
    characters: [{ personaId: PERSONA, role: "protagonist" }],
    durationSeconds: 30,
    renderVariantsPerShot: 2,
  }, "codex");
  assert.equal(result.creativeJob.type, "short_drama");
  assert.equal(result.creativeJob.status, "ready_for_generation");
  assert.ok(result.idealVersion.scorecard.total > 0.65);
  assert.equal(generations.length, result.idealVersion.shotPlan.length);
  assert.equal(generations[0].input.count, 2);
  assert.equal(generations[0].input.personaBindings[0].personaId, PERSONA);
  const storedGeneration = await repository.getGeneration("ws_demo", generations[0].id);
  assert.equal(storedGeneration.creativeJobId, result.creativeJob.id);
  assert.equal(storedGeneration.creativeVersionId, result.idealVersion.id);
  assert.equal(storedGeneration.shotId, "shot-01");
  assert.equal(result.widget.type, "creative.short_drama");
});

test("creative job creation is idempotent", async () => {
  const { service, generations } = fixture();
  const input = {
    idempotencyKey: "same-request",
    premise: "Один звонок меняет решение героини",
    characters: [{ personaId: PERSONA }],
  };
  const first = await service.createShortDrama("ws_demo", input, "claude");
  const second = await service.createShortDrama("ws_demo", input, "claude");
  assert.equal(second.creativeJob.id, first.creativeJob.id);
  assert.equal(generations.length, first.idealVersion.shotPlan.length);
});

test("autostart dispatches every generated shot when Runpod is configured", async () => {
  const dispatched = [];
  const dispatcher = {
    configured: true,
    async dispatch(_workspaceId, generationId) { dispatched.push(generationId); },
    async reconcile() {},
  };
  const { service } = fixture({ dispatcher });
  const result = await service.createShortDrama("ws_demo", {
    premise: "Героиня встречает человека, которого считала погибшим",
    characters: [{ personaId: PERSONA }],
  }, "codex");
  assert.equal(result.creativeJob.status, "generating");
  assert.equal(dispatched.length, result.idealVersion.shotPlan.length);
});

test("selects the strongest provider output for a shot", () => {
  const selected = selectBestProviderOutput({
    id: "gen_00000000000000000000000000000001",
    shotId: "shot-01",
    providerJobId: "rp-1",
    providerOutput: {
      outputs: [
        { id: "a", url: "https://media/a.mp4", quality: { total: 0.71 } },
        { id: "b", url: "https://media/b.mp4", quality: { total: 0.93 } },
      ],
    },
  });
  assert.equal(selected.outputId, "b");
  assert.equal(selected.quality, 0.93);
});
