import { HttpError } from "./errors.mjs";

const STATUS_MAP = Object.freeze({
  IN_QUEUE: "queued",
  IN_PROGRESS: "running",
  RUNNING: "running",
  COMPLETED: "succeeded",
  FAILED: "failed",
  TIMED_OUT: "failed",
  CANCELLED: "cancelled",
});

function mappedStatus(providerStatus, fallback = "queued") {
  return STATUS_MAP[providerStatus] ?? fallback;
}

export class GenerationDispatchService {
  /**
   * @param {{repository:any, personaService:any, runpodClient:any, generationMediaUrlTtlSeconds?:number, clock?:()=>Date}} options
   */
  constructor({
    repository,
    personaService,
    runpodClient,
    generationMediaUrlTtlSeconds = 1_800,
    clock = () => new Date(),
  }) {
    this.repository = repository;
    this.personaService = personaService;
    this.runpodClient = runpodClient;
    this.generationMediaUrlTtlSeconds = generationMediaUrlTtlSeconds;
    this.clock = clock;
  }
  get configured() { return this.runpodClient.configured; }

  async dispatch(workspaceId, generationId) {
    const generation = await this.repository.getGeneration(workspaceId, generationId);
    if (!generation) throw new HttpError(404, "generation_not_found", "Generation request not found");
    if (generation.providerJobId) return generation;
    const payload = {
      task: "render_shot",
      hubGenerationId: generation.id,
      creativeJobId: generation.creativeJobId ?? null,
      creativeVersionId: generation.creativeVersionId ?? null,
      shotId: generation.shotId ?? null,
      inputHash: generation.inputHash,
      workflow: {
        id: generation.input.workflowId,
        version: generation.input.workflowVersion,
      },
      generation: {
        prompt: generation.input.prompt,
        negativePrompt: generation.input.negativePrompt,
        outputType: generation.input.outputType,
        aspectRatio: generation.input.aspectRatio,
        count: generation.input.count,
        seed: generation.input.seed,
      },
      personas: generation.personaSnapshots.map((snapshot) => ({
        personaId: snapshot.personaId,
        personaVersion: snapshot.personaVersion,
        referenceId: snapshot.reference.id,
        referenceSha256: snapshot.reference.sha256,
        referenceUrl: this.#generationReferenceUrl(workspaceId, snapshot.reference.id),
        role: snapshot.role,
        identityMode: snapshot.identityMode,
        referenceStrength: snapshot.referenceStrength,
        preserveFace: snapshot.preserveFace,
        preserveWardrobe: snapshot.preserveWardrobe,
      })),
      resultContract: {
        version: 1,
        expected: "manifest",
        fields: [
          "outputs[].id",
          "outputs[].url",
          "outputs[].quality.total",
          "model",
          "runtimeMs",
          "cost",
        ],
      },
    };
    const submitted = await this.runpodClient.submit(payload);
    if (!submitted.id) throw new HttpError(502, "runpod_invalid_response", "Runpod did not return a job id", submitted);
    const now = this.clock().toISOString();
    const next = {
      ...generation,
      status: mappedStatus(submitted.status),
      providerJobId: submitted.id,
      providerState: submitted,
      dispatchedAt: now,
      updatedAt: now,
    };
    return this.repository.updateGeneration(next);
  }

  async dispatchAssembly(creativeJob) {
    if (!creativeJob?.bestVersion?.assemblyManifest) {
      throw new HttpError(409, "assembly_manifest_missing", "Creative job has no assembly manifest");
    }
    const submitted = await this.runpodClient.submit({
      task: "assemble_short_drama",
      creativeJobId: creativeJob.id,
      creativeVersionId: creativeJob.bestVersion.id,
      title: creativeJob.bestVersion.title,
      aspectRatio: creativeJob.brief.aspectRatio,
      durationSeconds: creativeJob.brief.durationSeconds,
      language: creativeJob.brief.language,
      script: creativeJob.bestVersion.script,
      assemblyManifest: creativeJob.bestVersion.assemblyManifest,
      output: {
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        normalizeLoudness: true,
        burnSubtitles: false,
      },
      resultContract: {
        version: 1,
        expected: "final_asset",
        fields: ["url", "sha256", "durationSeconds", "width", "height", "runtimeMs", "cost"],
      },
    });
    if (!submitted.id) throw new HttpError(502, "runpod_invalid_response", "Runpod did not return an assembly job id", submitted);
    return {
      providerJobId: submitted.id,
      status: mappedStatus(submitted.status),
      providerState: submitted,
      dispatchedAt: this.clock().toISOString(),
    };
  }

  async reconcileAssembly(providerJobId) {
    const providerState = await this.runpodClient.status(providerJobId);
    return {
      providerJobId,
      status: mappedStatus(providerState.status),
      providerState,
      output: providerState.output ?? null,
      checkedAt: this.clock().toISOString(),
    };
  }

  #generationReferenceUrl(workspaceId, referenceId) {
    const token = this.personaService.mediaSigner.issueReferenceUrl({
      workspaceId,
      referenceId,
      purpose: "generation",
      ttlSeconds: this.generationMediaUrlTtlSeconds,
    });
    return `${this.personaService.publicOrigin}/media/references/${encodeURIComponent(referenceId)}?${token.query}`;
  }

  async reconcile(workspaceId, generationId) {
    const generation = await this.repository.getGeneration(workspaceId, generationId);
    if (!generation) throw new HttpError(404, "generation_not_found", "Generation request not found");
    if (!generation.providerJobId) return generation;
    const status = await this.runpodClient.status(generation.providerJobId);
    const mapped = mappedStatus(status.status, generation.status);
    const next = {
      ...generation,
      status: mapped,
      providerState: status,
      providerOutput: status.output ?? generation.providerOutput ?? null,
      updatedAt: this.clock().toISOString(),
    };
    if (["succeeded", "failed", "cancelled"].includes(mapped)) next.completedAt = this.clock().toISOString();
    return this.repository.updateGeneration(next);
  }
}
