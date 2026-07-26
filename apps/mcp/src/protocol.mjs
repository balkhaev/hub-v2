import { HubClient } from "./hub-client.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = Object.freeze({ name: "luv-hub", version: "0.2.0" });

const tools = Object.freeze([
  {
    name: "hub_create_short_drama",
    description: "Create and start a Hub quality-loop for a vertical short drama. Hub generates and scores story variants, selects an ideal production version, creates shot-level video generation requests, and dispatches them to Runpod when configured.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["premise"],
      properties: {
        premise: { type: "string", description: "Core dramatic situation or desired story." },
        title: { type: "string" },
        durationSeconds: { type: "integer", minimum: 10, maximum: 180, default: 45 },
        platform: { type: "string", enum: ["instagram_reels", "tiktok", "youtube_shorts", "x", "owned_media"] },
        language: { type: "string", default: "ru" },
        tone: { type: "string", enum: ["melodrama", "romantic", "thriller", "mystery", "comedy", "dark_comedy"] },
        targetAudience: { type: "string" },
        callToAction: { type: "string" },
        constraints: { type: "array", items: { type: "string" }, maxItems: 20 },
        mustInclude: { type: "array", items: { type: "string" }, maxItems: 20 },
        mustAvoid: { type: "array", items: { type: "string" }, maxItems: 20 },
        characters: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["personaId"],
            properties: {
              personaId: { type: "string" },
              personaVersion: { type: "integer", minimum: 1 },
              referenceId: { type: "string" },
              role: { type: "string" },
              identityMode: { type: "string", enum: ["strict", "balanced", "loose"] },
              referenceStrength: { type: "number", minimum: 0, maximum: 1 },
              preserveWardrobe: { type: "boolean" },
            },
          },
        },
        variationCount: { type: "integer", minimum: 2, maximum: 6, default: 3 },
        renderVariantsPerShot: { type: "integer", minimum: 1, maximum: 4, default: 2 },
        maxIterations: { type: "integer", minimum: 1, maximum: 5, default: 3 },
        qualityThreshold: { type: "number", minimum: 0.65, maximum: 0.98, default: 0.86 },
        idempotencyKey: { type: "string" },
        autostart: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "hub_get_short_drama",
    description: "Read the current short-drama job, ideal version, scorecard, shot plan, generation IDs, and Hub review URL.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: { jobId: { type: "string" } },
    },
  },
  {
    name: "hub_reconcile_short_drama",
    description: "Refresh all Runpod shot jobs and update the short-drama progress. Call this after generation has had time to run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: { jobId: { type: "string" } },
    },
  },
  {
    name: "hub_list_personas",
    description: "List reusable Hub Persona/NPC cards so a short drama can pin exact visual identities.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

function textResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function createMcpDispatcher({ client = new HubClient() } = {}) {
  return async function dispatch(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return rpcError(message?.id ?? null, -32600, "Invalid Request");
    }
    const id = message.id;
    if (message.method === "initialize") {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Use Hub tools for media-production requests. Do not claim a video exists until the creative job reports ready_for_review or completed.",
      });
    }
    if (message.method === "notifications/initialized") return null;
    if (message.method === "ping") return rpcResult(id, {});
    if (message.method === "tools/list") return rpcResult(id, { tools });
    if (message.method !== "tools/call") return rpcError(id, -32601, `Method not found: ${message.method}`);

    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    try {
      let value;
      if (name === "hub_create_short_drama") value = await client.createShortDrama(args);
      else if (name === "hub_get_short_drama") value = await client.getShortDrama(args.jobId);
      else if (name === "hub_reconcile_short_drama") value = await client.reconcileShortDrama(args.jobId);
      else if (name === "hub_list_personas") value = await client.listPersonas();
      else return rpcError(id, -32602, `Unknown tool: ${name}`);
      return rpcResult(id, textResult(value));
    } catch (error) {
      return rpcResult(
        id,
        textResult(
          {
            error: error.message,
            code: error.code ?? "tool_execution_failed",
            status: error.status ?? null,
            details: error.details ?? null,
          },
          true,
        ),
      );
    }
  };
}

export { tools as HUB_MCP_TOOLS };
