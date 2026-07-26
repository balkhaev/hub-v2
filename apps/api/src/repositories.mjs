import { HttpError } from "./errors.mjs";

function initialState() {
  return {
    schemaVersion: 1,
    personas: [],
    references: [],
    generations: [],
  };
}

export class JsonHubRepository {
  /** @param {{read: Function, mutate: Function}} store */
  constructor(store) {
    this.store = store;
  }

  async createPersona(persona, reference) {
    return this.store.mutate((draft) => {
      if (draft.personas.some((item) => item.id === persona.id)) {
        throw new HttpError(409, "persona_exists", "Persona already exists");
      }
      draft.personas.push(persona);
      draft.references.push(reference);
      return persona;
    });
  }

  async listPersonas(workspaceId) {
    const state = await this.store.read();
    return state.personas
      .filter((item) => item.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getPersona(workspaceId, personaId) {
    const state = await this.store.read();
    return state.personas.find(
      (item) => item.workspaceId === workspaceId && item.id === personaId,
    ) ?? null;
  }

  async getReference(workspaceId, referenceId) {
    const state = await this.store.read();
    return state.references.find(
      (item) => item.workspaceId === workspaceId && item.id === referenceId,
    ) ?? null;
  }

  async addReference(workspaceId, personaId, nextPersona, reference) {
    return this.store.mutate((draft) => {
      const index = draft.personas.findIndex(
        (item) => item.workspaceId === workspaceId && item.id === personaId,
      );
      if (index === -1) {
        throw new HttpError(404, "persona_not_found", "Persona not found");
      }
      draft.personas[index] = nextPersona;
      draft.references.push(reference);
      return nextPersona;
    });
  }

  async createGeneration(generation) {
    return this.store.mutate((draft) => {
      draft.generations.push(generation);
      return generation;
    });
  }

  async getGeneration(workspaceId, generationId) {
    const state = await this.store.read();
    return state.generations.find(
      (item) => item.workspaceId === workspaceId && item.id === generationId,
    ) ?? null;
  }
}

export class MemoryHubRepository {
  constructor() {
    this.state = initialState();
  }

  async createPersona(persona, reference) {
    this.state.personas.push(structuredClone(persona));
    this.state.references.push(structuredClone(reference));
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

  async addReference(workspaceId, personaId, nextPersona, reference) {
    const index = this.state.personas.findIndex(
      (candidate) => candidate.workspaceId === workspaceId && candidate.id === personaId,
    );
    if (index === -1) throw new HttpError(404, "persona_not_found", "Persona not found");
    this.state.personas[index] = structuredClone(nextPersona);
    this.state.references.push(structuredClone(reference));
    return structuredClone(nextPersona);
  }

  async createGeneration(generation) {
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
