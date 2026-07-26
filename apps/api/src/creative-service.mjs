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
function recordStage(job, stage, payload = {}) {
  if (job.stageHistory.some((item) => item.stage === stage)) return;
  job.stageHistory.push({ stage, ...payload });
}

function normalizedProviderOutputs(providerOutput) {
  if (Array.isArray(providerOutput)) return providerOutput;
  if (Array.isArray(providerOutput?.outputs)) return providerOutput.outputs;
  if (providerOutput && typeof providerOutput === "object" && (providerOutput.url || providerOutput.assetUrl)) {
    return [providerOutput];
  }
  return [];
}

function outputQuality(output) {
  const raw =
    output?.quality?.total ??
    output?.qualityScore ??
    output?.score ??
    output?.metrics?.qualityScore ??
    null;
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

export function selectBestProviderOutput(generation) {
  const outputs = normalizedProviderOutputs(generation.providerOutput);
  if (outputs.length === 0) return null;
  const ranked = outputs
    .map((output, index) => ({ output, index, quality: outputQuality(output) }))
    .sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1) || a.index - b.index);
  const selected = ranked[0];
  return {
    generationId: generation.id,
    shotId: generation.shotId ?? null,
    providerJobId: generation.providerJobId ?? null,
    outputId: selected.output.id ?? selected.output.outputId ?? `output-${selected.index + 1}`,
    url: selected.output.url ?? selected.output.assetUrl ?? null,
    quality: selected.quality,
    providerOutput: structuredClone(selected.output),
  };
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
      const generation = {
        ...generationPayload.generation,
        creativeJobId: jobId,
        creativeVersionId: bestVersion.id,
        shotId: shot.shotId,
      };
      await this.repository.updateGeneration(generation);
      generationIds.push(generation.id);
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
      try {
        for (const generationId of generationIds) {
          await this.generationDispatcher.dispatch(workspaceId, generationId);
        }
        recordStage(stored, "runpod_jobs_dispatched", {
          at: this.clock().toISOString(),
          count: generationIds.length,
        });
        stored.updatedAt = this.clock().toISOString();
        await this.repository.updateCreativeJob(stored);
      } catch (error) {
        stored.status = "failed";
        stored.stage = "dispatch_failed";
        stored.lastError = {
          code: error.code ?? "dispatch_failed",
          message: error.message,
          at: this.clock().toISOString(),
        };
        stored.updatedAt = this.clock().toISOString();
        recordStage(stored, "runpod_dispatch_failed", { at: stored.updatedAt });
        await this.repository.updateCreativeJob(stored);
        throw error;
      }
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

    if (job.assemblyProviderJobId && this.generationDispatcher?.configured) {
      return this.#reconcileAssembly(job);
    }

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
      const renderSelections = generations.map(selectBestProviderOutput);
      const missingSelections = renderSelections.filter((selection) => selection === null).length;
      if (missingSelections > 0) {
        next.status = "evaluating";
        next.stage = "render_manifest_incomplete";
        next.progress = 0.9;
        next.renderSummary.missingSelections = missingSelections;
      } else {
        next.bestVersion.renderSelections = renderSelections;
        next.bestVersion.assemblyManifest = {
          version: 1,
          creativeJobId: next.id,
          creativeVersionId: next.bestVersion.id,
          aspectRatio: next.brief.aspectRatio,
          durationSeconds: next.brief.durationSeconds,
          orderedShots: renderSelections.map((selection, ordinal) => ({
            ordinal,
            shotId: selection.shotId,
            generationId: selection.generationId,
            providerJobId: selection.providerJobId,
            selectedOutputId: selection.outputId,
            url: selection.url,
            quality: selection.quality,
          })),
        };
        recordStage(next, "best_shot_outputs_selected", {
          at: now,
          count: total,
        });

        if (this.generationDispatcher?.configured) {
          try {
            const assembly = await this.generationDispatcher.dispatchAssembly(next);
            next.assemblyProviderJobId = assembly.providerJobId;
            next.assemblyProviderState = assembly.providerState;
            next.assemblyDispatchedAt = assembly.dispatchedAt;
            next.status = "generating";
            next.stage = "assembling_final";
            next.progress = 0.96;
            recordStage(next, "final_assembly_dispatched", {
              at: assembly.dispatchedAt,
              providerJobId: assembly.providerJobId,
            });
          } catch (error) {
            next.status = "failed";
            next.stage = "assembly_dispatch_failed";
            next.lastError = {
              code: error.code ?? "assembly_dispatch_failed",
              message: error.message,
              at: this.clock().toISOString(),
            };
            next.updatedAt = this.clock().toISOString();
            await this.repository.updateCreativeJob(next);
            throw error;
          }
        } else {
          next.status = "ready_for_review";
          next.stage = "ideal_render_package_ready";
          next.progress = 0.95;
        }
      }
    } else if (active > 0) {
      next.status = "generating";
      next.stage = "rendering_shots";
      next.progress = Math.max(0.48, 0.48 + (succeeded / total) * 0.4);
    }
    next.updatedAt = this.clock().toISOString();
    const stored = await this.repository.updateCreativeJob(next);
    return this.#payload(stored);
  }

  async #reconcileAssembly(job) {
    const assembly = await this.generationDispatcher.reconcileAssembly(job.assemblyProviderJobId);
    const next = structuredClone(job);
    next.assemblyProviderState = assembly.providerState;
    next.updatedAt = this.clock().toISOString();

    if (assembly.status === "succeeded") {
      next.finalAsset = assembly.output;
      next.status = "ready_for_review";
      next.stage = "final_asset_ready";
      next.progress = 0.99;
      recordStage(next, "final_asset_ready", {
        at: next.updatedAt,
        providerJobId: assembly.providerJobId,
      });
    } else if (["failed", "cancelled"].includes(assembly.status)) {
      next.status = "failed";
      next.stage = "assembly_failed";
      next.lastError = {
        code: "assembly_failed",
        message: `Final assembly ended with status ${assembly.status}`,
        at: next.updatedAt,
      };
      recordStage(next, "final_assembly_failed", {
        at: next.updatedAt,
        providerJobId: assembly.providerJobId,
      });
    } else {
      next.status = "generating";
      next.stage = "assembling_final";
      next.progress = Math.max(next.progress, 0.96);
    }

    const stored = await this.repository.updateCreativeJob(next);
    return this.#payload(stored);
  }

  #payload(job) {
    return {
      creativeJob: structuredClone(job),
      idealVersion: job.bestVersion ? structuredClone(job.bestVersion) : null,
      widget: creativeJobWidget(job),
    };
  }
}
