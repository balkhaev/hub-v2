import test from "node:test";
import assert from "node:assert/strict";
import { produceIdealStoryPackage } from "../src/creative-engine.mjs";
import { parseCreateShortDrama } from "../../../packages/contracts/src/creative-job.mjs";

const PERSONA = "per_0123456789abcdef0123456789abcdef";

test("quality loop produces scored ideal version and shot plan", () => {
  const brief = parseCreateShortDrama({
    premise: "Девушка узнаёт, что её партнёр скрывал письмо, которое могло изменить их жизнь",
    characters: [{ personaId: PERSONA, role: "protagonist" }],
    durationSeconds: 45,
    qualityThreshold: 0.86,
    maxIterations: 3,
  });
  const result = produceIdealStoryPackage(brief);
  assert.ok(result.iterations.length >= 1);
  assert.ok(result.best.scorecard.total >= 0.65);
  assert.ok(result.best.shotPlan.length >= 5);
  assert.equal(result.best.shotPlan[0].shotId, "shot-01");
  assert.match(result.best.shotPlan[0].generationPrompt, /Vertical cinematic short drama/);
});

test("short drama contract rejects duplicate characters", () => {
  assert.throws(() => parseCreateShortDrama({
    premise: "test",
    characters: [{ personaId: PERSONA }, { personaId: PERSONA }],
  }), /duplicate personaId/);
});
