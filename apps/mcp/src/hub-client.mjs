export class HubClient {
  constructor({
    baseUrl = process.env.HUB_API_URL ?? "http://127.0.0.1:3000",
    workspaceId = process.env.HUB_WORKSPACE_ID ?? "ws_demo",
    actorId = process.env.HUB_ACTOR_ID ?? "mcp-agent",
    apiToken = process.env.HUB_API_TOKEN ?? null,
    fetchImpl = fetch,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.workspaceId = workspaceId;
    this.actorId = actorId;
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
  }
  async listPersonas() { return this.#request("GET", "/api/v1/personas"); }
  async createShortDrama(input) {
    return this.#request("POST", "/api/v1/creative-jobs", input, input.idempotencyKey ?? null);
  }
  async getShortDrama(jobId) {
    return this.#request("GET", `/api/v1/creative-jobs/${encodeURIComponent(jobId)}`);
  }
  async reconcileShortDrama(jobId) {
    return this.#request("POST", `/api/v1/creative-jobs/${encodeURIComponent(jobId)}/reconcile`, {});
  }
  async #request(method, path, body, idempotencyKey) {
    const headers = {
      "content-type": "application/json",
      "x-workspace-id": this.workspaceId,
      "x-actor-id": this.actorId,
    };
    if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message ?? `Hub request failed with ${response.status}`);
      error.code = payload.error?.code ?? "hub_request_failed";
      error.status = response.status;
      error.details = payload.error?.details;
      throw error;
    }
    return payload;
  }
}
