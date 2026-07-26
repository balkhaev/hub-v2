import { HttpError } from "./errors.mjs";

export class RunpodClient {
  /** @param {{apiKey?:string|null, endpointId?:string|null, fetchImpl?:typeof fetch, baseUrl?:string}} options */
  constructor({ apiKey = null, endpointId = null, fetchImpl = fetch, baseUrl = "https://api.runpod.ai/v2" } = {}) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  get configured() {
    return Boolean(this.apiKey && this.endpointId);
  }
  async submit(input) {
    if (!this.configured) throw new HttpError(503, "runpod_not_configured", "Runpod endpoint is not configured");
    return this.#request("POST", "/run", { input });
  }
  async status(jobId) {
    if (!this.configured) throw new HttpError(503, "runpod_not_configured", "Runpod endpoint is not configured");
    return this.#request("GET", `/status/${encodeURIComponent(jobId)}`);
  }
  async cancel(jobId) {
    if (!this.configured) throw new HttpError(503, "runpod_not_configured", "Runpod endpoint is not configured");
    return this.#request("POST", `/cancel/${encodeURIComponent(jobId)}`);
  }
  async #request(method, suffix, body) {
    const response = await this.fetchImpl(`${this.baseUrl}/${this.endpointId}${suffix}`, {
      method,
      headers: {
        authorization: this.apiKey,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
    if (!response.ok) {
      throw new HttpError(response.status, "runpod_request_failed", "Runpod request failed", payload);
    }
    return payload;
  }
}
