import { createHash, randomInt } from "node:crypto";
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

/** @param {unknown} value */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

/** @param {unknown} value */
function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

/** @param {string} workspaceId @param {string} idempotencyKey */
function deterministicSeed(workspaceId, idempotencyKey) {
  const digest = createHash("sha256")
    .update(`${workspaceId}\n${idempotencyKey}`)
    .digest();
  return digest.readUInt32BE(0);
}

export class PersonaService {
  /**
   * @param {{repository: any, objectStore: any, mediaSigner: any, publicOrigin: string, clock?: () => Date, randomSeed?: () => number}} options
   */
  constructor({
    repository,
    objectStore,
    mediaSigner,
    publicOrigin,
    clock = () => new Date(),
    randomSeed = () => randomInt(0, 0x1_0000_0000),
  }) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.mediaSigner = mediaSigner;
    this.publicOrigin = publicOrigin.replace(/\/$/, "");
    this.clock = clock;
    this.randomSeed = randomSeed;
  }

  /** @param {string} workspaceId @param {string} referenceId @param {string} purpose */
  mediaUrl(workspaceId, referenceId, purpose = "preview") {
    const token = this.mediaSigner.issueReferenceUrl({ workspaceId, referenceId, purpose });
    return `${this.publicOrigin}/media/references/${encodeURIComponent(referenceId)}?${token.query}`;
  }

  /**
   * @param {{workspaceId: string, referenceId: string, purpose: string, expiresAt: unknown, signature: unknown}} input
   */
  async resolveReferenceMedia({ workspaceId, referenceId, purpose, expiresAt, signature }) {
    this.mediaSigner.verifyReferenceUrl({
      workspaceId,
      referenceId,
      purpose,
      expiresAt,
      signature,
    });
    const reference = await this.#requiredReference(workspaceId, referenceId);
    const persona = await this.#requiredPersona(workspaceId, reference.personaId);
    if (persona.subjectType === "consenting_adult" && persona.consent.status === "revoked") {
      throw new HttpError(403, "consent_revoked", "Persona consent has been revoked");
    }
    if (purpose === "generation") {
      this.#assertPersonaUsable(persona, "image", "internal_concept");
    }
    return reference.asset;
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
      schemaVersion: 2,
      id: referenceId,
      workspaceId,
      personaId,
      version: 1,
      kind: "source_photo",
      usage: parsed.sourceImage.usage,
      label: parsed.sourceImage.label,
      notes: parsed.sourceImage.notes,
      asset,
      createdBy: actorId,
      createdAt: now,
    };

    const persona = {
      schemaVersion: 2,
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
        attestedAt: parsed.consent.status === "not_required" ? null : now,
      },
      primaryReferenceId: referenceId,
      referenceIds: [referenceId],
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    const personaVersion = this.#buildPersonaVersion(persona, actorId, now);

    await this.repository.createPersona(persona, reference, personaVersion);
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
    if (
      parsed.expectedPersonaVersion !== null &&
      parsed.expectedPersonaVersion !== persona.version
    ) {
      throw new HttpError(
        409,
        "persona_version_conflict",
        "Persona version is stale",
        { expectedVersion: parsed.expectedPersonaVersion, actualVersion: persona.version },
      );
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
      schemaVersion: 2,
      id: referenceId,
      workspaceId,
      personaId,
      version: persona.referenceIds.length + 1,
      kind: "source_photo",
      usage: parsed.sourceImage.usage,
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
    const personaVersion = this.#buildPersonaVersion(nextPersona, actorId, now);

    await this.repository.addReference(
      workspaceId,
      personaId,
      persona.version,
      nextPersona,
      reference,
      personaVersion,
    );
    const primaryReference = parsed.setAsPrimary
      ? reference
      : await this.#requiredReference(workspaceId, nextPersona.primaryReferenceId);
    return this.#personaPayload(nextPersona, primaryReference);
  }

  /** @param {string} workspaceId @param {unknown} input @param {string} actorId */
  async createGenerationRequest(workspaceId, input, actorId) {
    const parsed = parseGenerationRequest(input);
    const requestHash = sha256Json(parsed);
    if (parsed.idempotencyKey) {
      const existing = await this.repository.getGenerationByIdempotencyKey(
        workspaceId,
        parsed.idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "Idempotency key was already used for a different generation request",
          );
        }
        return this.#generationPayload(existing);
      }
    }

    const now = this.clock().toISOString();
    const personaSnapshots = [];

    for (const binding of parsed.personaBindings) {
      const currentPersona = await this.#requiredPersona(workspaceId, binding.personaId);
      this.#assertPersonaUsable(currentPersona, parsed.outputType, parsed.usage);

      const selectedVersion = binding.personaVersion ?? currentPersona.version;
      const personaVersion = await this.repository.getPersonaVersion(
        workspaceId,
        currentPersona.id,
        selectedVersion,
      );
      if (!personaVersion) {
        throw new HttpError(
          404,
          "persona_version_not_found",
          `Persona version ${selectedVersion} was not found`,
        );
      }
      const referenceId = binding.referenceId ?? personaVersion.primaryReferenceId;
      if (!personaVersion.referenceIds.includes(referenceId)) {
        throw new HttpError(
          409,
          "reference_not_in_persona_version",
          "Selected reference did not exist in the selected persona version",
        );
      }
      const reference = await this.#requiredReference(workspaceId, referenceId);
      if (reference.personaId !== currentPersona.id) {
        throw new HttpError(
          409,
          "reference_persona_mismatch",
          "Reference belongs to another persona",
        );
      }

      personaSnapshots.push({
        personaId: currentPersona.id,
        personaVersion: personaVersion.version,
        personaVersionId: personaVersion.id,
        displayName: personaVersion.displayName,
        subjectType: personaVersion.subjectType,
        visualProfile: structuredClone(personaVersion.visualProfile),
        consentDecision: {
          status: currentPersona.consent.status,
          allowedMedia: structuredClone(currentPersona.consent.allowedMedia),
          commercialUse: currentPersona.consent.commercialUse,
          expiresAt: currentPersona.consent.expiresAt,
          checkedAt: now,
        },
        role: binding.role,
        referenceStrength: binding.referenceStrength,
        identityMode: binding.identityMode,
        preserveFace:
          binding.preserveFace ?? personaVersion.visualProfile.identityLocks.face,
        preserveWardrobe: binding.preserveWardrobe,
        reference: {
          id: reference.id,
          version: reference.version,
          usage: reference.usage,
          objectKey: reference.asset.objectKey,
          mediaType: reference.asset.mediaType,
          sha256: reference.asset.sha256,
        },
      });
    }

    const idempotencyKey = parsed.idempotencyKey ?? createId("idem");
    const normalizedInput = {
      prompt: parsed.prompt,
      negativePrompt: parsed.negativePrompt,
      outputType: parsed.outputType,
      aspectRatio: parsed.aspectRatio,
      usage: parsed.usage,
      count: parsed.count,
      seed:
        parsed.seed ??
        (parsed.idempotencyKey
          ? deterministicSeed(workspaceId, parsed.idempotencyKey)
          : this.randomSeed()),
      workflowId: parsed.workflowId,
      workflowVersion: parsed.workflowVersion,
      requestedModelId: parsed.requestedModelId,
      requestedModelVersion: parsed.requestedModelVersion,
    };
    const inputHash = sha256Json({ input: normalizedInput, personaSnapshots });
    const generation = {
      schemaVersion: 2,
      id: createId("gen"),
      workspaceId,
      idempotencyKey,
      requestHash,
      inputHash,
      status: "ready_for_dispatch",
      provider: "runpod",
      providerJobId: null,
      resolvedModel: null,
      input: normalizedInput,
      personaSnapshots,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    };

    const stored = await this.repository.createGeneration(generation);
    return this.#generationPayload(stored);
  }

  /** @param {string} workspaceId @param {string} generationId */
  async getGenerationRequest(workspaceId, generationId) {
    const generation = await this.repository.getGeneration(workspaceId, generationId);
    if (!generation) {
      throw new HttpError(404, "generation_not_found", "Generation request not found");
    }
    return this.#generationPayload(generation);
  }

  /** @param {Record<string, any>} persona @param {string} outputType @param {string} usage */
  #assertPersonaUsable(persona, outputType, usage) {
    if (persona.status !== "active") {
      throw new HttpError(409, "persona_archived", `Persona ${persona.displayName} is archived`);
    }
    if (persona.subjectType !== "consenting_adult") return;
    if (!["attested", "verified"].includes(persona.consent.status)) {
      throw new HttpError(409, "consent_unavailable", "Persona consent is not active");
    }
    if (
      persona.consent.expiresAt &&
      Date.parse(persona.consent.expiresAt) <= this.clock().getTime()
    ) {
      throw new HttpError(409, "consent_expired", "Persona consent has expired");
    }
    if (!persona.consent.allowedMedia.includes(outputType)) {
      throw new HttpError(
        409,
        "media_scope_denied",
        `Consent does not allow ${outputType} generation`,
      );
    }
    if (usage !== "internal_concept" && persona.consent.commercialUse !== true) {
      throw new HttpError(
        409,
        "commercial_use_denied",
        "Consent does not allow marketing use",
      );
    }
  }

  /** @param {Record<string, any>} persona @param {string} actorId @param {string} now */
  #buildPersonaVersion(persona, actorId, now) {
    return {
      schemaVersion: 1,
      id: createId("pver"),
      workspaceId: persona.workspaceId,
      personaId: persona.id,
      version: persona.version,
      displayName: persona.displayName,
      subjectType: persona.subjectType,
      visualProfile: structuredClone(persona.visualProfile),
      primaryReferenceId: persona.primaryReferenceId,
      referenceIds: [...persona.referenceIds],
      createdBy: actorId,
      createdAt: now,
    };
  }

  /** @param {Record<string, any>} persona @param {Record<string, any>} reference */
  #personaPayload(persona, reference) {
    const imageUrl = this.mediaUrl(persona.workspaceId, reference.id, "preview");
    return {
      persona,
      primaryReference: {
        ...reference,
        imageUrl,
      },
      widget: personaCardWidget(persona, reference, imageUrl),
    };
  }

  /** @param {Record<string, any>} generation */
  #generationPayload(generation) {
    const publicGeneration = structuredClone(generation);
    for (const snapshot of publicGeneration.personaSnapshots) {
      delete snapshot.reference.objectKey;
    }
    return {
      generation: publicGeneration,
      widget: generationRequestWidget(publicGeneration),
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
      throw new HttpError(404, "reference_not_found", "Persona reference is missing");
    }
    return reference;
  }
}
