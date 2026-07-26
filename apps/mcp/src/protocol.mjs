import { HubClient } from "./hub-client.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = Object.freeze({ name: "luv-hub", version: "0.2.0" });

const tools = Object.freeze([
  {
    name: "hub_create_short_drama",
    description: "Create and start a Hub quality-loop for a vertical short drama. When capable, provide 2–6 distinct candidateDrafts authored by the calling agent; Hub normalizes, scores, refines, versions and selects the strongest production package, then creates shot-level video generations and dispatches them to Runpod when configured.",
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
        candidateDrafts: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          description: "Distinct complete story candidates authored by the calling agent. Prefer three meaningfully different dramatic mechanisms.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["logline", "hook", "beats", "payoff"],
            properties: {
              title: { type: "string" },
              logline: { type: "string" },
              hook: { type: "string" },
              beats: {
                type: "array",
                minItems: 3,
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["action"],
                  properties: {
                    beat: { type: "string" },
                    atSecond: { type: "integer", minimum: 0 },
                    purpose: { type: "string" },
                    action: { type: "string" },
                  },
                },
              },
              dialogue: {
                type: "array",
                maxItems: 16,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["speaker", "line"],
                  properties: {
                    speaker: { type: "string" },
                    line: { type: "string" },
                  },
                },
              },
              payoff: { type: "string" },
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
    description: "Read the current short-drama job, ideal version, scorecard, shot plan, selected shot renders, assembly manifest, final asset, and Hub review URL.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["jobId"],
      properties: { jobId: { type: "string" } },
    },
  },
  {
    name: "hub_reconcile_short_drama",
    description: "Refresh Runpod shot and assembly jobs, select the strongest provider output per shot, and update aggregate short-drama progress.",
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

function compactCreativeResult(payload) {
  const job = payload?.creativeJob ?? {};
  const ideal = payload?.idealVersion ?? null;
  return {
    creativeJob: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      hubUrl: job.hubUrl,
      renderSummary: job.renderSummary ?? null,
      finalAsset: job.finalAsset ?? null,
      lastError: job.lastError ?? null,
    },
    idealVersion: ideal
      ? {
          id: ideal.id,
          title: ideal.title,
          logline: ideal.logline,
          hook: ideal.hook,
          scorecard: ideal.scorecard,
          script: ideal.script,
          shotPlan: ideal.shotPlan,
          generationIds: ideal.generationIds,
          renderSelections: ideal.renderSelections ?? [],
          assemblyManifest: ideal.assemblyManifest ?? null,
        }
      : null,
  };
}

function compactPersonaResult(payload) {
  return {
    items: (payload?.items ?? []).map((item) => ({
      personaId: item.persona?.id,
      displayName: item.persona?.displayName,
      subjectType: item.persona?.subjectType,
      status: item.persona?.status,
      version: item.persona?.version,
      primaryReferenceId: item.persona?.primaryReferenceId,
      consentStatus: item.persona?.consent?.status,
    })),
  };
}

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
        instructions: "Use Hub tools for media-production requests. Prefer supplying multiple complete candidate drafts. Do not claim a video exists until the creative job reports ready_for_review or completed and includes a final asset or an explicitly described render package.",
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
      if (name === "hub_create_short_drama") value = compactCreativeResult(await client.createShortDrama(args));
      else if (name === "hub_get_short_drama") value = compactCreativeResult(await client.getShortDrama(args.jobId));
      else if (name === "hub_reconcile_short_drama") value = compactCreativeResult(await client.reconcileShortDrama(args.jobId));
      else if (name === "hub_list_personas") value = compactPersonaResult(await client.listPersonas());
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
