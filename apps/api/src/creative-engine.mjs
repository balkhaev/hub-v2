import { createHash } from "node:crypto";

const ARCHETYPES = Object.freeze([
  {
    key: "secret_reveal",
    label: "Секрет",
    hook: (p) => `Она получила сообщение, которое не должна была увидеть: ${p}`,
    reversal: "герой понимает, что очевидная правда была специально подстроена",
    payoff: "признание меняет смысл первой сцены",
  },
  {
    key: "impossible_choice",
    label: "Выбор",
    hook: (p) => `У героя есть десять секунд, чтобы выбрать — любовь или правда. ${p}`,
    reversal: "оба варианта оказываются частью одной проверки",
    payoff: "герой выбирает человека, но отказывается от лжи",
  },
  {
    key: "missed_timing",
    label: "Опоздание",
    hook: (p) => `Они ждали этой встречи год, но один из них пришёл на минуту позже. ${p}`,
    reversal: "опоздание спасает их от решения, о котором оба пожалели бы",
    payoff: "последняя реплика зеркалит первую",
  },
  {
    key: "betrayal",
    label: "Предательство",
    hook: (p) => `Самый близкий человек только что предал героя — или сделал вид, что предал. ${p}`,
    reversal: "предательство было способом защитить героя",
    payoff: "герой видит цену защиты и принимает собственное решение",
  },
  {
    key: "reunion",
    label: "Возвращение",
    hook: (p) => `Человек из прошлого вернулся ровно тогда, когда герой почти отпустил его. ${p}`,
    reversal: "вернулся не просить прощения, а вернуть то, что герой потерял в себе",
    payoff: "вместо воссоединения герои выбирают честное новое начало",
  },
]);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}
function round(value) {
  return Math.round(value * 1000) / 1000;
}
function hashNumber(value) {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}
function words(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
function sentence(value) {
  const trimmed = value.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
function characterLabel(brief, index = 0) {
  return brief.characters[index]?.role ?? (index === 0 ? "герой" : "второй герой");
}

function makeCandidate(brief, archetype, candidateIndex, iteration, previous) {
  const protagonist = characterLabel(brief, 0);
  const counterpart = characterLabel(brief, 1);
  const premise = sentence(brief.premise);
  const refinement = iteration > 1
    ? `Версия ${iteration}: конфликт начинается раньше, реплики короче, финальный образ точнее.`
    : "";
  const inherited = previous ? `Сохраняется сильная идея: ${previous.payoff}` : "";
  const hook = archetype.hook(premise);
  const beats = [
    {
      beat: "hook",
      atSecond: 0,
      purpose: "Открыть эмоциональный вопрос до первого свайпа",
      action: hook,
    },
    {
      beat: "setup",
      atSecond: Math.max(2, Math.round(brief.durationSeconds * 0.12)),
      purpose: "Сделать желание героя однозначным",
      action: `${protagonist} хочет получить честный ответ, пока ${counterpart} пытается удержать контроль.`,
    },
    {
      beat: "escalation",
      atSecond: Math.round(brief.durationSeconds * 0.38),
      purpose: "Увеличить цену решения",
      action: `Появляется доказательство, после которого прежние отношения уже невозможны. ${inherited}`.trim(),
    },
    {
      beat: "reversal",
      atSecond: Math.round(brief.durationSeconds * 0.66),
      purpose: "Переосмыслить предыдущие кадры",
      action: sentence(archetype.reversal),
    },
    {
      beat: "payoff",
      atSecond: Math.max(brief.durationSeconds - 6, Math.round(brief.durationSeconds * 0.84)),
      purpose: "Закрыть эмоциональный вопрос и оставить послевкусие",
      action: `${sentence(archetype.payoff)} ${refinement}`.trim(),
    },
  ];
  const dialogue = [
    { speaker: protagonist, line: iteration > 1 ? "Скажи правду. Одним предложением." : "Ты мог просто сказать мне правду." },
    { speaker: counterpart, line: "Я боялся не правды. Я боялся, что ты останешься." },
    { speaker: protagonist, line: candidateIndex % 2 === 0 ? "Теперь я останусь только по своему выбору." : "Тогда впервые не решай за меня." },
  ];
  const title = brief.title ?? `${archetype.label}: ${brief.premise.slice(0, 52)}`;
  return {
    archetype: archetype.key,
    label: `${archetype.label} · v${iteration}.${candidateIndex + 1}`,
    title,
    logline: `${protagonist} должен пережить ${archetype.label.toLowerCase()}, чтобы выбрать честность вместо удобной иллюзии.`,
    hook,
    premise,
    beats,
    dialogue,
    payoff: archetype.payoff,
    refinementNotes: [
      iteration > 1 ? "Hook shortened and conflict moved into the first three seconds" : "Initial concept",
      "One dominant emotional question",
      "Reversal recontextualizes the opening image",
      "Ending can loop into the first frame",
    ],
  };
}

export function scoreStoryCandidate(candidate, brief) {
  const seed = hashNumber(`${brief.premise}|${candidate.archetype}|${candidate.label}`);
  const hookWords = words(candidate.hook);
  const dialogueWords = candidate.dialogue.reduce((sum, line) => sum + words(line.line), 0);
  const targetDialogue = Math.max(18, brief.durationSeconds * 1.4);
  const hook = clamp(0.94 - Math.abs(hookWords - 18) / 80 + seed * 0.025);
  const emotionalArc = clamp(0.72 + candidate.beats.length * 0.035 + (candidate.payoff ? 0.05 : 0));
  const clarity = clamp(0.93 - Math.abs(dialogueWords - targetDialogue) / Math.max(120, targetDialogue * 3));
  const retention = clamp(
    0.67 +
      (candidate.beats.some((beat) => beat.beat === "reversal") ? 0.12 : 0) +
      (candidate.hook.includes("?") || candidate.hook.includes(":") ? 0.05 : 0) +
      seed * 0.04,
  );
  const personaContinuity = brief.characters.length ? 0.93 : 0.82;
  const platformFit = clamp(
    0.9 - Math.max(0, brief.durationSeconds - 75) / 180 + (brief.aspectRatio === "9:16" ? 0.035 : 0),
  );
  const feasibility = clamp(0.91 - Math.max(0, brief.mustInclude.length - 4) * 0.025);
  const brandSafety = clamp(0.96 - brief.mustAvoid.length * 0.006);
  const total =
    hook * 0.18 +
    emotionalArc * 0.18 +
    clarity * 0.13 +
    retention * 0.18 +
    personaContinuity * 0.12 +
    platformFit * 0.1 +
    feasibility * 0.07 +
    brandSafety * 0.04;
  return Object.fromEntries(
    Object.entries({
      hook,
      emotionalArc,
      clarity,
      retention,
      personaContinuity,
      platformFit,
      feasibility,
      brandSafety,
      total,
    }).map(([key, value]) => [key, round(value)]),
  );
}

export function buildShotPlan(candidate, brief) {
  const shotCount = Math.max(5, Math.min(12, Math.round(brief.durationSeconds / 4.5)));
  const baseDuration = brief.durationSeconds / shotCount;
  const framings = ["extreme close-up", "close-up", "medium", "over-shoulder", "wide", "insert"];
  const beatForIndex = (index) => {
    const progress = index / Math.max(1, shotCount - 1);
    if (progress < 0.18) return candidate.beats[0];
    if (progress < 0.38) return candidate.beats[1];
    if (progress < 0.65) return candidate.beats[2];
    if (progress < 0.84) return candidate.beats[3];
    return candidate.beats[4];
  };
  return Array.from({ length: shotCount }, (_, index) => {
    const beat = beatForIndex(index);
    const dialogue = candidate.dialogue[index % candidate.dialogue.length];
    const durationSeconds = round(
      index === 0 ? Math.min(2.4, baseDuration) : index === shotCount - 1 ? Math.min(4.5, baseDuration + 0.6) : baseDuration,
    );
    const visualAction = index === 0
      ? "A face reacts before the audience knows why; a phone notification is reflected in the eyes"
      : index === shotCount - 1
        ? "The final gesture mirrors the opening frame, but the emotional power has changed hands"
        : beat.action;
    return {
      shotId: `shot-${String(index + 1).padStart(2, "0")}`,
      ordinal: index,
      beat: beat.beat,
      durationSeconds,
      framing: framings[index % framings.length],
      visualAction,
      dialogue: index < candidate.dialogue.length ? dialogue : null,
      emotion: beat.beat === "hook" ? "alarm" : beat.beat === "reversal" ? "recognition" : beat.beat === "payoff" ? "controlled release" : "contained tension",
      generationPrompt: [
        `Vertical cinematic short drama, ${brief.tone}, ${brief.language} audience`,
        `${framings[index % framings.length]}, ${visualAction}`,
        `emotional continuity: ${beat.purpose}`,
        "natural micro-expressions, motivated camera movement, coherent wardrobe and face identity",
        "premium social video, realistic lighting, no text baked into image",
      ].join(". "),
      negativePrompt: [
        "identity drift",
        "face morphing",
        "extra fingers",
        "lip sync artifacts",
        "wardrobe discontinuity",
        "camera teleportation",
        ...brief.mustAvoid,
      ].join(", "),
      continuity: {
        characterState: `${beat.beat}:${index}`,
        preserveScreenDirection: index > 0,
        preserveWardrobe: true,
        matchPreviousEndFrame: index > 0,
      },
    };
  });
}

export function produceIdealStoryPackage(brief) {
  const iterations = [];
  let previousWinner = null;
  let best = null;
  for (let iteration = 1; iteration <= brief.maxIterations; iteration += 1) {
    const candidates = Array.from({ length: brief.variationCount }, (_, candidateIndex) => {
      const archetype = ARCHETYPES[(candidateIndex + iteration - 1) % ARCHETYPES.length];
      const candidate = makeCandidate(brief, archetype, candidateIndex, iteration, previousWinner);
      const scorecard = scoreStoryCandidate(candidate, brief);
      return { ...candidate, scorecard };
    }).sort((a, b) => b.scorecard.total - a.scorecard.total);
    const winner = candidates[0];
    iterations.push({ iteration, candidates, winnerLabel: winner.label, winnerScore: winner.scorecard.total });
    if (!best || winner.scorecard.total > best.scorecard.total) best = winner;
    previousWinner = winner;
    if (winner.scorecard.total >= brief.qualityThreshold) break;
  }
  const shotPlan = buildShotPlan(best, brief);
  return {
    iterations,
    best: {
      ...best,
      shotPlan,
      scorecard: { ...best.scorecard, thresholdMet: best.scorecard.total >= brief.qualityThreshold },
    },
    evaluator: {
      version: "short-drama-rubric-v1",
      weights: {
        hook: 0.18,
        emotionalArc: 0.18,
        clarity: 0.13,
        retention: 0.18,
        personaContinuity: 0.12,
        platformFit: 0.1,
        feasibility: 0.07,
        brandSafety: 0.04,
      },
    },
  };
}
