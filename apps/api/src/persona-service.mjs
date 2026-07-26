import {
  createId,
  generationRequestWidget,
  parseAddPersonaReference,
  parseCreatePersona,
  parseGenerationRequest,
  personaCardWidget,
  slugify,
} from "../../../packages/contracts/src/index.mjs";
import { HttpError } from "./errors.mjs";

export class PersonaService {
  /**
   * @param {{repository: any, objectStore: any, publicOrigin: string, clock?: () => Date}} options
   */
  constructor({ repository, objectStore, publicOrigin, clock = () => new Date() }) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.publicOrigin = publicOrigin.replace(/\/$/, "");
    this.clock = clock;
  }

  /** @param {string} objectKey */
  mediaUrl(objectKey) {
    return `${this.publicOrigin}/media/${objectKey
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  /** @param {string} workspaceId @param {unknown} input @param {string} actorId */
  async createPersona(workspaceId, input, actorId) {
    const parsed = parseCreatePersona(input);
    const now = this.clock().toISOString();
    const asset = await this.objectStore.putImage({
      workspaceId,
      contentType: parsed.sourceImage.contentType,
      dataBase64: parsed.sourceImage.dataBase64,
      fileName: parsed.sourceImage.fileName,
    });

    const personaId = createId("per");
    const referenceId = createId("pref");
    const reference = {
      schemaVersion: 1,
      id: referenceId,
      workspaceId,
      personaId,
      version: 1,
      kind: "source_photo",
      label: parsed.sourceImage.label,
      notes: parsed.sourceImage.notes,
      asset,
      createdBy: actorId,
      createdAt: now,
    };

    const persona = {
      schemaVersion: 1,
      id: personaId,
      workspaceId,
      slug: slugify(parsed.displayName),
      displayName: parsed.displayName,
      subjectType: parsed.subjectType,
      status: "active",
      version: 1,
      visualProfile: parsed.visualProfile,
      consent: {
        ...parsed.consent,
        attestedAt:
          parsed.consent.status === "not_required" ? null : now,
      },
      primaryReferenceId: referenceId,
      referenceIds: [referenceId],
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.createPersona(persona, reference);
    return this.#personaPayload(persona, reference);
  }

  /** @param {string} workspaceId */
  async listPersonas(workspaceId) {
    const personas = await this.repository.listPersonas(workspaceId);
    const payloads = [];
    for (const persona of personas) {
      const reference = await this.#requiredReference(workspaceId, persona.primaryReferenceId);
      payloads.push(this.#personaPayload(persona, reference));
    }
    return payloads;
  }

  /** @param {string} workspaceId @param {string} personaId */
  async getPersona(workspaceId, personaId) {
    const persona = await this.#requiredPersona(workspaceId, personaId);
    const reference = await this.#requiredReference(workspaceId, persona.primaryReferenceId);
    return this.#personaPayload(persona, reference);
  }

  /**
   * @param {string} workspaceId
   * @param {string} personaId
   * @param {unknown} input
   * @param {string} actorId
   */
  async addReference(workspaceId, personaId, input, actorId) {
    const parsed = parseAddPersonaReference(input);
    const persona = await this.#requiredPersona(workspaceId, personaId);
    if (persona.status !== "active") {
      throw new HttpError(409, "persona_archived", "Cannot add a reference to an archived persona");
    }

    const now = this.clock().toISOString();
    const asset = await this.objectStore.putImage({
      workspaceId,
      contentType: parsed.sourceImage.contentType,
      dataBase64: parsed.sourceImage.dataBase64,
      fileName: parsed.sourceImage.fileName,
    });
    const referenceId = createId("pref");
    const reference = {
      schemaVersion: 1,
      id: referenceId,
      workspaceId,
      personaId,
      version: persona.referenceIds.length + 1,
      kind: "source_photo",
      label: parsed.sourceImage.label,
      notes: parsed.sourceImage.notes,
      asset,
      createdBy: actorId,
      createdAt: now,
    };
    const nextPersona = {
      ...persona,
      version: persona.version + 1,
      primaryReferenceId: parsed.setAsPrimary ? referenceId : persona.primaryReferenceId,
      referenceIds: [...persona.referenceIds, referenceId],
      updatedAt: now,
    };

    await this.repository.addReference(workspaceId, personaId, nextPersona, reference);
    const primaryReference = parsed.setAsPrimary
      ? reference
      : await this.#requiredReference(workspaceId, nextPersona.primaryReferenceId);
    return this.#personaPayload(nextPersona, primaryReference);
  }

  /** @param {string} workspaceId @param {unknown} input @param {string} actorId */
  async createGenerationRequest(workspaceId, input, actorId) {
    const parsed = parseGenerationRequest(input);
    const now = this.clock().toISOString();
    const personaSnapshots = [];

    for (const binding of parsed.personaBindings) {
      const persona = await this.#requiredPersona(workspaceId, binding.personaId);
      if (persona.status !== "active") {
        throw new HttpError(
          409,
          "persona_archived",
          `Persona ${persona.displayName} is archived`,
        );
      }
      const reference = await this.#requiredReference(workspaceId, persona.primaryReferenceId);
      personaSnapshots.push({
        personaId: persona.id,
        personaVersion: persona.version,
        displayName: persona.displayName,
        subjectType: persona.subjectType,
        visualProfile: structuredClone(persona.visualProfile),
        consentStatus: persona.consent.status,
        role: binding.role,
        referenceStrength: binding.referenceStrength,
        preserveFace: binding.preserveFace,
        preserveWardrobe: binding.preserveWardrobe,
        reference: {
          id: reference.id,
          version: reference.version,
          objectKey: reference.asset.objectKey,
          mediaType: reference.asset.mediaType,
          sha256: reference.asset.sha256,
        },
      });
    }

    const generation = {
      schemaVersion: 1,
      id: createId("gen"),
      workspaceId,
      status: "ready_for_dispatch",
      provider: "runpod",
      providerJobId: null,
      input: {
        prompt: parsed.prompt,
        negativePrompt: parsed.negativePrompt,
        outputType: parsed.outputType,
        aspectRatio: parsed.aspectRatio,
        count: parsed.count,
        workflowId: parsed.workflowId,
      },
      personaSnapshots,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.createGeneration(generation);
    return {
      generation,
      widget: generationRequestWidget(generation),
    };
  }

  /** @param {string} workspaceId @param {string} generationId */
  async getGenerationRequest(workspaceId, generationId) {
    const generation = await this.repository.getGeneration(workspaceId, generationId);
    if (!generation) {
      throw new HttpError(404, "generation_not_found", "Generation request not found");
    }
    return { generation, widget: generationRequestWidget(generation) };
  }

  /** @param {Record<string, any>} persona @param {Record<string, any>} reference */
  #personaPayload(persona, reference) {
    const imageUrl = this.mediaUrl(reference.asset.objectKey);
    return {
      persona,
      primaryReference: {
        ...reference,
        imageUrl,
      },
      widget: personaCardWidget(persona, reference, imageUrl),
    };
  }

  /** @param {string} workspaceId @param {string} personaId */
  async #requiredPersona(workspaceId, personaId) {
    const persona = await this.repository.getPersona(workspaceId, personaId);
    if (!persona) {
      throw new HttpError(404, "persona_not_found", "Persona not found");
    }
    return persona;
  }

  /** @param {string} workspaceId @param {string} referenceId */
  async #requiredReference(workspaceId, referenceId) {
    const reference = await this.repository.getReference(workspaceId, referenceId);
    if (!reference) {
      throw new HttpError(500, "reference_missing", "Persona reference is missing");
    }
    return reference;
  }
}
