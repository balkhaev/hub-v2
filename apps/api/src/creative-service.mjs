import { createHash } from "node:crypto";
import {
  createId,
  creativeJobWidget,
  parseCreateShortDrama,
} from "../../../packages/contracts/src/index.mjs";
import { produceIdealStoryPackage } from "./creative-engine.mjs";
import { HttpError } from "./errors.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
function actorIdempotencyKey(jobId, shotId) {
  return `${jobId}:${shotId}`;
}

export class CreativeService {
  /**
   * @param {{repository:any, personaService:any, generationDispatcher?:any, publicOrigin:string, clock?:()=>Date}} options
   */
  constructor({ repository, personaService, generationDispatcher = null, publicOrigin, clock = () => new Date() }) {
    this.repository = repository;
    this.personaService = personaService;
    this.generationDispatcher = generationDispatcher;
    this.publicOrigin = publicOrigin.replace(/\/$/, "");
    this.clock = clock;
  }

  async createShortDrama(workspaceId, input, actorId) {
    const brief = parseCreateShortDrama(input);
    const requestHash = sha256Json(brief);
    if (brief.idempotencyKey) {
      const existing = await this.repository.getCreativeJobByIdempotencyKey(workspaceId, brief.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new HttpError(409, "idempotency_conflict", "Idempotency key was already used for a different creative job");
        }
        return this.#payload(existing);
      }
    }

    const now = this.clock().toISOString();
    const jobId = createId("cjob");
    const packageResult = produceIdealStoryPackage(brief);
    const bestVersion = {
      id: createId("cver"),
      label: "ideal-v1",
      title: packageResult.best.title,
      logline: packageResult.best.logline,
      hook: packageResult.best.hook,
      script: {
        premise: packageResult.best.premise,
        beats: packageResult.best.beats,
        dialogue: packageResult.best.dialogue,
        payoff: packageResult.best.payoff,
      },
      shotPlan: packageResult.best.shotPlan,
      scorecard: packageResult.best.scorecard,
      generationIds: [],
      renderVariantsPerShot: brief.renderVariantsPerShot,
      createdAt: now,
    };

    const generationIds = [];
    if (brief.characters.length > 0) {
      for (const shot of bestVersion.shotPlan) {
        const generationPayload = await this.personaService.createGenerationRequest(
          workspaceId,
          {
            idempotencyKey: actorIdempotencyKey(jobId, shot.shotId),
            prompt: shot.generationPrompt,
            negativePrompt: shot.negativePrompt,
            outputType: "video",
            aspectRatio: brief.aspectRatio,
            usage: brief.usage,
            count: brief.renderVariantsPerShot,
            workflowId: "short-drama-shot-v1",
            workflowVersion: "1",
            personaBindings: brief.characters.map((character) => ({
              personaId: character.personaId,
              personaVersion: character.personaVersion,
              referenceId: character.referenceId,
              role: character.role,
              identityMode: character.identityMode,
              referenceStrength: character.referenceStrength,
              preserveWardrobe: character.preserveWardrobe,
            })),
          },
          actorId,
        );
        generationIds.push(generationPayload.generation.id);
      }
    }
    bestVersion.generationIds = generationIds;

    const canDispatch = Boolean(brief.autostart && this.generationDispatcher?.configured && generationIds.length);
    const job = {
      schemaVersion: 1,
      id: jobId,
      workspaceId,
      type: "short_drama",
      idempotencyKey: brief.idempotencyKey ?? createId("idem"),
      requestHash,
      status: canDispatch ? "generating" : "ready_for_generation",
      stage: canDispatch ? "rendering_shots" : "ideal_plan_ready",
      progress: canDispatch ? 0.48 : 0.42,
      brief: {
        ...brief,
        title: brief.title ?? packageResult.best.title,
      },
      iterations: packageResult.iterations,
      evaluator: packageResult.evaluator,
      bestVersion,
      stageHistory: [
        { stage: "brief_validated", at: now },
        { stage: "story_candidates_scored", at: now, count: packageResult.iterations.length },
        { stage: "ideal_plan_selected", at: now, score: bestVersion.scorecard.total },
        { stage: "shot_generations_created", at: now, count: generationIds.length },
      ],
      hubUrl: `${this.publicOrigin}/?creativeJob=${encodeURIComponent(jobId)}`,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    const stored = await this.repository.createCreativeJob(job);
    if (canDispatch) {
      for (const generationId of generationIds) {
        await this.generationDispatcher.dispatch(workspaceId, generationId);
      }
      stored.stageHistory.push({ stage: "runpod_jobs_dispatched", at: this.clock().toISOString(), count: generationIds.length });
      stored.updatedAt = this.clock().toISOString();
      await this.repository.updateCreativeJob(stored);
    }
    return this.#payload(stored);
  }

  async listCreativeJobs(workspaceId) {
    const jobs = await this.repository.listCreativeJobs(workspaceId);
    return jobs.map((job) => this.#payload(job));
  }

  async getCreativeJob(workspaceId, jobId) {
    const job = await this.repository.getCreativeJob(workspaceId, jobId);
    if (!job) throw new HttpError(404, "creative_job_not_found", "Creative job not found");
    return this.#payload(job);
  }

  async reconcileCreativeJob(workspaceId, jobId) {
    const job = await this.repository.getCreativeJob(workspaceId, jobId);
    if (!job) throw new HttpError(404, "creative_job_not_found", "Creative job not found");
    const generationIds = job.bestVersion?.generationIds ?? [];
    if (generationIds.length === 0) return this.#payload(job);

    const generations = [];
    for (const generationId of generationIds) {
      if (this.generationDispatcher?.configured) {
        await this.generationDispatcher.reconcile(workspaceId, generationId);
      }
      const generation = await this.repository.getGeneration(workspaceId, generationId);
      if (generation) generations.push(generation);
    }

    const succeeded = generations.filter((generation) => generation.status === "succeeded").length;
    const failed = generations.filter((generation) => generation.status === "failed").length;
    const active = generations.filter((generation) => ["queued", "running"].includes(generation.status)).length;
    const total = generationIds.length;
    const now = this.clock().toISOString();
    const next = structuredClone(job);
    next.renderSummary = { total, succeeded, failed, active, checkedAt: now };
    if (failed > 0) {
      next.status = "failed";
      next.stage = "render_failed";
      next.progress = Math.max(next.progress, 0.5);
    } else if (succeeded === total) {
      next.status = "ready_for_review";
      next.stage = "ideal_render_ready";
      next.progress = 0.95;
      next.stageHistory.push({ stage: "all_shots_rendered", at: now, count: total });
    } else if (active > 0) {
      next.status = "generating";
      next.stage = "rendering_shots";
      next.progress = Math.max(0.48, 0.48 + (succeeded / total) * 0.4);
    }
    next.updatedAt = now;
    const updated = await this.repository.updateCreativeJob(next);
    return this.#payload(updated);
  }

  #payload(job) {
    return {
      creativeJob: structuredClone(job),
      idealVersion: job.bestVersion ? structuredClone(job.bestVersion) : null,
      widget: creativeJobWidget(job),
    };
  }
}
