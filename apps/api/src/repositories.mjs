import { HttpError } from "./errors.mjs";

function ensureCollections(state) {
  state.schemaVersion = Math.max(Number(state.schemaVersion ?? 1), 3);
  state.personas ??= [];
  state.references ??= [];
  state.personaVersions ??= [];
  state.generations ??= [];
  state.creativeJobs ??= [];
  return state;
}
function initialState() { return ensureCollections({ schemaVersion: 3 }); }
function assertSameIdempotentRequest(existing, incoming, label) {
  if (existing.requestHash !== incoming.requestHash) {
    throw new HttpError(409, "idempotency_conflict", `Idempotency key was already used for a different ${label}`);
  }
}

class RepositoryBase {
  async _read() { throw new Error("not implemented"); }
  async _mutate() { throw new Error("not implemented"); }
  async createPersona(persona, reference, personaVersion) {
    return this._mutate((draft) => {
      if (draft.personas.some((item) => item.id === persona.id)) throw new HttpError(409, "persona_exists", "Persona already exists");
      draft.personas.push(persona); draft.references.push(reference); draft.personaVersions.push(personaVersion); return persona;
    });
  }
  async listPersonas(workspaceId) {
    const state = await this._read();
    return state.personas.filter((item) => item.workspaceId === workspaceId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  async getPersona(workspaceId, personaId) {
    const state = await this._read(); return state.personas.find((item)=>item.workspaceId===workspaceId&&item.id===personaId) ?? null;
  }
  async getReference(workspaceId, referenceId) {
    const state = await this._read(); return state.references.find((item)=>item.workspaceId===workspaceId&&item.id===referenceId) ?? null;
  }
  async getPersonaVersion(workspaceId, personaId, version) {
    const state = await this._read(); return state.personaVersions.find((item)=>item.workspaceId===workspaceId&&item.personaId===personaId&&item.version===version) ?? null;
  }
  async addReference(workspaceId, personaId, expectedVersion, nextPersona, reference, personaVersion) {
    return this._mutate((draft) => {
      const index = draft.personas.findIndex((item)=>item.workspaceId===workspaceId&&item.id===personaId);
      if (index === -1) throw new HttpError(404,"persona_not_found","Persona not found");
      if (draft.personas[index].version !== expectedVersion) throw new HttpError(409,"persona_version_conflict","Persona changed while the reference was being added",{expectedVersion,actualVersion:draft.personas[index].version});
      draft.personas[index]=nextPersona; draft.references.push(reference); draft.personaVersions.push(personaVersion); return nextPersona;
    });
  }
  async getGenerationByIdempotencyKey(workspaceId, idempotencyKey) {
    const state=await this._read(); return state.generations.find((item)=>item.workspaceId===workspaceId&&item.idempotencyKey===idempotencyKey) ?? null;
  }
  async createGeneration(generation) {
    return this._mutate((draft)=>{
      const existing=draft.generations.find((item)=>item.workspaceId===generation.workspaceId&&item.idempotencyKey===generation.idempotencyKey);
      if(existing){assertSameIdempotentRequest(existing,generation,"generation request");return existing;}
      draft.generations.push(generation);return generation;
    });
  }
  async getGeneration(workspaceId,generationId){const state=await this._read();return state.generations.find((item)=>item.workspaceId===workspaceId&&item.id===generationId)??null;}
  async updateGeneration(generation){
    return this._mutate((draft)=>{const index=draft.generations.findIndex((item)=>item.workspaceId===generation.workspaceId&&item.id===generation.id);if(index===-1)throw new HttpError(404,"generation_not_found","Generation request not found");draft.generations[index]=generation;return generation;});
  }
  async getCreativeJobByIdempotencyKey(workspaceId,idempotencyKey){const state=await this._read();return state.creativeJobs.find((item)=>item.workspaceId===workspaceId&&item.idempotencyKey===idempotencyKey)??null;}
  async createCreativeJob(job){
    return this._mutate((draft)=>{const existing=draft.creativeJobs.find((item)=>item.workspaceId===job.workspaceId&&item.idempotencyKey===job.idempotencyKey);if(existing){assertSameIdempotentRequest(existing,job,"creative job");return existing;}draft.creativeJobs.push(job);return job;});
  }
  async getCreativeJob(workspaceId,jobId){const state=await this._read();return state.creativeJobs.find((item)=>item.workspaceId===workspaceId&&item.id===jobId)??null;}
  async listCreativeJobs(workspaceId){const state=await this._read();return state.creativeJobs.filter((item)=>item.workspaceId===workspaceId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  async updateCreativeJob(job){return this._mutate((draft)=>{const index=draft.creativeJobs.findIndex((item)=>item.workspaceId===job.workspaceId&&item.id===job.id);if(index===-1)throw new HttpError(404,"creative_job_not_found","Creative job not found");draft.creativeJobs[index]=job;return job;});}
}

export class JsonHubRepository extends RepositoryBase {
  constructor(store){super();this.store=store;}
  async _read(){return ensureCollections(await this.store.read());}
  async _mutate(mutator){return this.store.mutate((raw)=>mutator(ensureCollections(raw)));}
}
export class MemoryHubRepository extends RepositoryBase {
  constructor(){super();this.state=initialState();}
  async _read(){return structuredClone(this.state);}
  async _mutate(mutator){const result=await mutator(this.state);return structuredClone(result);}
}
