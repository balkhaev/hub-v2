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

test("quality loop evaluates agent-authored candidate drafts", () => {
  const brief = parseCreateShortDrama({
    premise: "Она узнаёт правду в лифте",
    durationSeconds: 30,
    candidateDrafts: [
      {
        title: "Лифт",
        logline: "Героиня застревает с человеком, который скрывал её письмо.",
        hook: "Двери закрылись, и он сказал: письмо было у меня.",
        beats: [
          { beat: "hook", action: "Признание звучит до того, как лифт начинает двигаться." },
          { beat: "conflict", action: "Она требует объяснить потерянный год." },
          { beat: "reversal", action: "Письмо скрыли по просьбе её будущей версии." },
          { beat: "payoff", action: "Она выходит из лифта, но оставляет двери открытыми." },
        ],
        dialogue: [{ speaker: "она", line: "Ты украл у меня год." }],
        payoff: "Открытые двери становятся новым выбором.",
      },
      {
        title: "Сигнал",
        logline: "Сбой связи открывает старое голосовое признание.",
        hook: "Телефон произнёс её имя голосом человека, которого рядом не было.",
        beats: [
          { action: "Старое сообщение запускается само." },
          { action: "Героиня понимает дату записи." },
          { action: "Собеседник признаёт, что слышал его раньше." },
          { action: "Последняя фраза отвечает на вопрос из первого кадра." },
        ],
        dialogue: [{ speaker: "она", line: "Почему ты дал мне услышать это только сейчас?" }],
        payoff: "Она удаляет не сообщение, а ложь вокруг него.",
      },
    ],
  });
  const result = produceIdealStoryPackage(brief);
  assert.equal(result.iterations[0].candidates.length, 2);
  assert.ok(result.iterations[0].candidates.every((candidate) => candidate.archetype === "agent_draft"));
  assert.ok(result.best.shotPlan.length >= 5);
});
