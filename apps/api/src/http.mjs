import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeError, HttpError } from "./errors.mjs";

const JSON_BODY_LIMIT = 22 * 1024 * 1024;
const CONTEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

/** @param {import('node:http').ServerResponse} response */
function securityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

/** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} body */
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

/** @param {import('node:http').IncomingMessage} request */
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      throw new HttpError(413, "request_too_large", "Request body is too large");
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

/** @param {import('node:http').IncomingMessage} request @param {boolean} required */
function requestContext(request, required) {
  const workspaceHeader = request.headers["x-workspace-id"];
  const actorHeader = request.headers["x-actor-id"];
  const workspaceId = (
    Array.isArray(workspaceHeader) ? workspaceHeader[0] : workspaceHeader
  )?.trim();
  const actorId = (Array.isArray(actorHeader) ? actorHeader[0] : actorHeader)?.trim();
  if (required && (!workspaceId || !actorId)) {
    throw new HttpError(
      401,
      "context_required",
      "Authenticated workspace and actor context is required",
    );
  }
  const resolved = {
    workspaceId: workspaceId || "ws_demo",
    actorId: actorId || "local-user",
  };
  if (!CONTEXT_PATTERN.test(resolved.workspaceId) || !CONTEXT_PATTERN.test(resolved.actorId)) {
    throw new HttpError(
      400,
      "invalid_context",
      "Workspace or actor context has an invalid format",
    );
  }
  return resolved;
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string[]} allowedOrigins
 */
function applyCors(request, response, allowedOrigins) {
  const originHeader = request.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) return true;
  if (!allowedOrigins.includes(origin.replace(/\/$/, ""))) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,x-workspace-id,x-actor-id,idempotency-key",
  );
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("vary", "Origin");
  return true;
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} filePath
 * @param {string} contentType
 * @param {string=} cacheControl
 */
async function sendFile(response, filePath, contentType, cacheControl = "no-cache") {
  try {
    const bytes = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": bytes.length,
      "cache-control": cacheControl,
    });
    response.end(bytes);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new HttpError(404, "not_found", "Resource not found");
    }
    throw error;
  }
}

/** @param {Record<string, any>} asset */
function mediaContentType(asset) {
  if (["image/jpeg", "image/png", "image/webp"].includes(asset.mediaType)) {
    return asset.mediaType;
  }
  throw new HttpError(500, "unsupported_stored_media", "Stored media type is unsupported");
}

/**
 * @param {{service: any, objectStore: any, webRoot: string, requireContextHeaders: boolean, allowedOrigins: string[]}} dependencies
 */
export function createHttpHandler({
  service,
  objectStore,
  webRoot,
  requireContextHeaders,
  allowedOrigins,
}) {
  return async function handler(request, response) {
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
    securityHeaders(response);

    try {
      const corsAllowed = applyCors(request, response, allowedOrigins);
      if (!corsAllowed && request.method === "OPTIONS") {
        throw new HttpError(403, "origin_not_allowed", "Origin is not allowed");
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);

      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, { status: "ok", requestId });
        return;
      }
      if (request.method === "GET" && pathname === "/") {
        await sendFile(response, path.join(webRoot, "index.html"), "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname === "/app.js") {
        await sendFile(response, path.join(webRoot, "app.js"), "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && pathname === "/styles.css") {
        await sendFile(response, path.join(webRoot, "styles.css"), "text/css; charset=utf-8");
        return;
      }

      const mediaMatch = pathname.match(/^\/media\/references\/([^/]+)$/);
      if (request.method === "GET" && mediaMatch) {
        const workspaceId = url.searchParams.get("workspace") ?? "";
        const purpose = url.searchParams.get("purpose") ?? "preview";
        if (!CONTEXT_PATTERN.test(workspaceId)) {
          throw new HttpError(403, "invalid_media_workspace", "Media workspace is invalid");
        }
        const asset = await service.resolveReferenceMedia({
          workspaceId,
          referenceId: mediaMatch[1],
          purpose,
          expiresAt: url.searchParams.get("expires"),
          signature: url.searchParams.get("signature"),
        });
        await sendFile(
          response,
          objectStore.resolve(asset.objectKey),
          mediaContentType(asset),
          "private, max-age=60",
        );
        return;
      }

      const context = requestContext(request, requireContextHeaders);
      if (request.method === "GET" && pathname === "/api/v1/personas") {
        sendJson(response, 200, {
          items: await service.listPersonas(context.workspaceId),
          requestId,
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/v1/personas") {
        const result = await service.createPersona(
          context.workspaceId,
          await readJson(request),
          context.actorId,
        );
        sendJson(response, 201, { ...result, requestId });
        return;
      }

      const personaMatch = pathname.match(/^\/api\/v1\/personas\/([^/]+)$/);
      if (request.method === "GET" && personaMatch) {
        const result = await service.getPersona(context.workspaceId, personaMatch[1]);
        sendJson(response, 200, { ...result, requestId });
        return;
      }
      const referenceMatch = pathname.match(/^\/api\/v1\/personas\/([^/]+)\/references$/);
      if (request.method === "POST" && referenceMatch) {
        const result = await service.addReference(
          context.workspaceId,
          referenceMatch[1],
          await readJson(request),
          context.actorId,
        );
        sendJson(response, 201, { ...result, requestId });
        return;
      }
      if (request.method === "POST" && pathname === "/api/v1/generations") {
        const body = await readJson(request);
        const idempotencyHeader = request.headers["idempotency-key"];
        if (body.idempotencyKey === undefined && typeof idempotencyHeader === "string") {
          body.idempotencyKey = idempotencyHeader;
        }
        const result = await service.createGenerationRequest(
          context.workspaceId,
          body,
          context.actorId,
        );
        sendJson(response, 201, { ...result, requestId });
        return;
      }
      const generationMatch = pathname.match(/^\/api\/v1\/generations\/([^/]+)$/);
      if (request.method === "GET" && generationMatch) {
        const result = await service.getGenerationRequest(
          context.workspaceId,
          generationMatch[1],
        );
        sendJson(response, 200, { ...result, requestId });
        return;
      }
      throw new HttpError(404, "route_not_found", "Route not found");
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(response, normalized.status, {
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        },
        requestId,
      });
    }
  };
}
