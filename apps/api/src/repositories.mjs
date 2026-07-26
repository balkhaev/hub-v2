import { HttpError } from "./errors.mjs";

function ensureCollections(state) {
  state.schemaVersion = Math.max(Number(state.schemaVersion ?? 1), 2);
  state.personas ??= [];
  state.references ??= [];
  state.personaVersions ??= [];
  state.generations ??= [];
  return state;
}

function initialState() {
  return ensureCollections({ schemaVersion: 2 });
}

export class JsonHubRepository {
  /** @param {{read: Function, mutate: Function}} store */
  constructor(store) {
    this.store = store;
  }

  async createPersona(persona, reference, personaVersion) {
    return this.store.mutate((rawDraft) => {
      const draft = ensureCollections(rawDraft);
      if (draft.personas.some((item) => item.id === persona.id)) {
        throw new HttpError(409, "persona_exists", "Persona already exists");
      }
      draft.personas.push(persona);
      draft.references.push(reference);
      draft.personaVersions.push(personaVersion);
      return persona;
    });
  }

  async listPersonas(workspaceId) {
    const state = ensureCollections(await this.store.read());
    return state.personas
      .filter((item) => item.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPersona(workspaceId, personaId) {
    const state = ensureCollections(await this.store.read());
    return state.personas.find(
      (item) => item.workspaceId === workspaceId && item.id === personaId,
    ) ?? null;
  }

  async getReference(workspaceId, referenceId) {
    const state = ensureCollections(await this.store.read());
    return state.references.find(
      (item) => item.workspaceId === workspaceId && item.id === referenceId,
    ) ?? null;
  }

  async getPersonaVersion(workspaceId, personaId, version) {
    const state = ensureCollections(await this.store.read());
    return state.personaVersions.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.personaId === personaId &&
        item.version === version,
    ) ?? null;
  }

  async addReference(
    workspaceId,
    personaId,
    expectedVersion,
    nextPersona,
    reference,
    personaVersion,
  ) {
    return this.store.mutate((rawDraft) => {
      const draft = ensureCollections(rawDraft);
      const index = draft.personas.findIndex(
        (item) => item.workspaceId === workspaceId && item.id === personaId,
      );
      if (index === -1) {
        throw new HttpError(404, "persona_not_found", "Persona not found");
      }
      if (draft.personas[index].version !== expectedVersion) {
        throw new HttpError(
          409,
          "persona_version_conflict",
          "Persona changed while the reference was being added",
          { expectedVersion, actualVersion: draft.personas[index].version },
        );
      }
      draft.personas[index] = nextPersona;
      draft.references.push(reference);
      draft.personaVersions.push(personaVersion);
      return nextPersona;
    });
  }

  async createGeneration(generation) {
    return this.store.mutate((rawDraft) => {
      const draft = ensureCollections(rawDraft);
      const existing = draft.generations.find(
        (item) =>
          item.workspaceId === generation.workspaceId &&
          item.idempotencyKey === generation.idempotencyKey,
      );
      if (existing) {
        if (existing.inputHash !== generation.inputHash) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "Idempotency key was already used for a different generation request",
          );
        }
        return existing;
      }
      draft.generations.push(generation);
      return generation;
    });
  }

  async getGeneration(workspaceId, generationId) {
    const state = ensureCollections(await this.store.read());
    return state.generations.find(
      (item) => item.workspaceId === workspaceId && item.id === generationId,
    ) ?? null;
  }
}

export class MemoryHubRepository {
  constructor() {
    this.state = initialState();
  }

  async createPersona(persona, reference, personaVersion) {
    this.state.personas.push(structuredClone(persona));
    this.state.references.push(structuredClone(reference));
    this.state.personaVersions.push(structuredClone(personaVersion));
    return structuredClone(persona);
  }

  async listPersonas(workspaceId) {
    return this.state.personas
      .filter((item) => item.workspaceId === workspaceId)
      .map(structuredClone);
  }

  async getPersona(workspaceId, personaId) {
    const item = this.state.personas.find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === personaId,
    );
    return item ? structuredClone(item) : null;
  }

  async getReference(workspaceId, referenceId) {
    const item = this.state.references.find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === referenceId,
    );
    return item ? structuredClone(item) : null;
  }

  async getPersonaVersion(workspaceId, personaId, version) {
    const item = this.state.personaVersions.find(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        candidate.personaId === personaId &&
        candidate.version === version,
    );
    return item ? structuredClone(item) : null;
  }

  async addReference(
    workspaceId,
    personaId,
    expectedVersion,
    nextPersona,
    reference,
    personaVersion,
  ) {
    const index = this.state.personas.findIndex(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === personaId,
    );
    if (index === -1) {
      throw new HttpError(404, "persona_not_found", "Persona not found");
    }
    if (this.state.personas[index].version !== expectedVersion) {
      throw new HttpError(
        409,
        "persona_version_conflict",
        "Persona changed while the reference was being added",
      );
    }
    this.state.personas[index] = structuredClone(nextPersona);
    this.state.references.push(structuredClone(reference));
    this.state.personaVersions.push(structuredClone(personaVersion));
    return structuredClone(nextPersona);
  }

  async createGeneration(generation) {
    const existing = this.state.generations.find(
      (item) =>
        item.workspaceId === generation.workspaceId &&
        item.idempotencyKey === generation.idempotencyKey,
    );
    if (existing) {
      if (existing.inputHash !== generation.inputHash) {
        throw new HttpError(
          409,
          "idempotency_conflict",
          "Idempotency key was already used for a different generation request",
        );
      }
      return structuredClone(existing);
    }
    this.state.generations.push(structuredClone(generation));
    return structuredClone(generation);
  }

  async getGeneration(workspaceId, generationId) {
    const item = this.state.generations.find(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === generationId,
    );
    return item ? structuredClone(item) : null;
  }
}
