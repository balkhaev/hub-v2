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
      hubGenerationId: generation.id,
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
        fields: ["outputs", "model", "runtimeMs", "cost"],
      },
    };
    const submitted = await this.runpodClient.submit(payload);
    if (!submitted.id) throw new HttpError(502, "runpod_invalid_response", "Runpod did not return a job id", submitted);
    const next = {
      ...generation,
      status: STATUS_MAP[submitted.status] ?? "queued",
      providerJobId: submitted.id,
      providerState: submitted,
      dispatchedAt: this.clock().toISOString(),
      updatedAt: this.clock().toISOString(),
    };
    return this.repository.updateGeneration(next);
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
    const mapped = STATUS_MAP[status.status] ?? generation.status;
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
