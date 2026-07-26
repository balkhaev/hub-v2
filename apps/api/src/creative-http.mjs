import { randomUUID } from "node:crypto";
import { HttpError, normalizeError } from "./errors.mjs";

const BODY_LIMIT = 2 * 1024 * 1024;
const CONTEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(payload);
}
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, "request_too_large", "Request body is too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "invalid_json", "Request body is not valid JSON"); }
}
function context(request, required) {
  const workspace = request.headers["x-workspace-id"];
  const actor = request.headers["x-actor-id"];
  const workspaceId = (Array.isArray(workspace) ? workspace[0] : workspace)?.trim() || "ws_demo";
  const actorId = (Array.isArray(actor) ? actor[0] : actor)?.trim() || "mcp-agent";
  if (required && (!workspace || !actor)) throw new HttpError(401, "context_required", "Authenticated workspace and actor context is required");
  if (!CONTEXT_PATTERN.test(workspaceId) || !CONTEXT_PATTERN.test(actorId)) throw new HttpError(400, "invalid_context", "Workspace or actor context has an invalid format");
  return { workspaceId, actorId };
}
function applyCors(request, response, allowedOrigins) {
  const raw = request.headers.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (!origin) return;
  if (!allowedOrigins.includes(origin.replace(/\/$/, ""))) throw new HttpError(403, "origin_not_allowed", "Origin is not allowed");
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("access-control-allow-headers", "content-type,x-workspace-id,x-actor-id,idempotency-key");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("vary", "Origin");
}

/**
 * Returns true when the request belongs to this extension.
 * @param {{creativeService:any,generationDispatcher:any,requireContextHeaders:boolean,allowedOrigins:string[]}} dependencies
 */
export function createCreativeHttpHandler({ creativeService, generationDispatcher, requireContextHeaders, allowedOrigins }) {
  return async function handleCreativeRequest(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const isCreativeRoute = pathname === "/api/v1/creative-jobs" ||
      /^\/api\/v1\/creative-jobs\/[^/]+(?:\/reconcile)?$/.test(pathname) ||
      /^\/api\/v1\/generations\/[^/]+\/(?:dispatch|reconcile)$/.test(pathname);
    if (!isCreativeRoute) return false;

    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
    try {
      applyCors(request, response, allowedOrigins);
      if (request.method === "OPTIONS") {
        response.writeHead(204); response.end(); return true;
      }
      const requestContext = context(request, requireContextHeaders);
      if (request.method === "GET" && pathname === "/api/v1/creative-jobs") {
        sendJson(response, 200, { items: await creativeService.listCreativeJobs(requestContext.workspaceId), requestId });
        return true;
      }
      if (request.method === "POST" && pathname === "/api/v1/creative-jobs") {
        const body = await readJson(request);
        const idempotencyHeader = request.headers["idempotency-key"];
        if (body.idempotencyKey === undefined && typeof idempotencyHeader === "string") body.idempotencyKey = idempotencyHeader;
        const result = await creativeService.createShortDrama(requestContext.workspaceId, body, requestContext.actorId);
        sendJson(response, 201, { ...result, requestId });
        return true;
      }
      const reconcileCreative = pathname.match(/^\/api\/v1\/creative-jobs\/([^/]+)\/reconcile$/);
      if (request.method === "POST" && reconcileCreative) {
        const result = await creativeService.reconcileCreativeJob(requestContext.workspaceId, reconcileCreative[1]);
        sendJson(response, 200, { ...result, requestId });
        return true;
      }
      const getCreative = pathname.match(/^\/api\/v1\/creative-jobs\/([^/]+)$/);
      if (request.method === "GET" && getCreative) {
        const result = await creativeService.getCreativeJob(requestContext.workspaceId, getCreative[1]);
        sendJson(response, 200, { ...result, requestId });
        return true;
      }
      const dispatchGeneration = pathname.match(/^\/api\/v1\/generations\/([^/]+)\/dispatch$/);
      if (request.method === "POST" && dispatchGeneration) {
        const generation = await generationDispatcher.dispatch(requestContext.workspaceId, dispatchGeneration[1]);
        sendJson(response, 200, { generation, requestId });
        return true;
      }
      const reconcileGeneration = pathname.match(/^\/api\/v1\/generations\/([^/]+)\/reconcile$/);
      if (request.method === "POST" && reconcileGeneration) {
        const generation = await generationDispatcher.reconcile(requestContext.workspaceId, reconcileGeneration[1]);
        sendJson(response, 200, { generation, requestId });
        return true;
      }
      throw new HttpError(405, "method_not_allowed", "Method is not allowed for this route");
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(response, normalized.status, {
        error: { code: normalized.code, message: normalized.message, details: normalized.details },
        requestId,
      });
      return true;
    }
  };
}
