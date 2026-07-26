import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeError, HttpError } from "./errors.mjs";

const JSON_BODY_LIMIT = 22 * 1024 * 1024;

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
  const workspaceId = Array.isArray(workspaceHeader) ? workspaceHeader[0] : workspaceHeader;
  const actorId = Array.isArray(actorHeader) ? actorHeader[0] : actorHeader;

  if (required && (!workspaceId || !actorId)) {
    throw new HttpError(
      401,
      "context_required",
      "x-workspace-id and x-actor-id headers are required",
    );
  }

  return {
    workspaceId: workspaceId?.trim() || "ws_demo",
    actorId: actorId?.trim() || "local-user",
  };
}

/** @param {import('node:http').ServerResponse} response */
function setCors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type,x-workspace-id,x-actor-id");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

/** @param {import('node:http').ServerResponse} response @param {string} filePath @param {string} contentType */
async function sendFile(response, filePath, contentType) {
  try {
    const bytes = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": bytes.length,
      "cache-control": contentType.startsWith("image/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    response.end(bytes);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new HttpError(404, "not_found", "Resource not found");
    }
    throw error;
  }
}

/**
 * @param {{service: any, objectStore: any, webRoot: string, requireContextHeaders: boolean}} dependencies
 */
export function createHttpHandler({ service, objectStore, webRoot, requireContextHeaders }) {
  return async function handler(request, response) {
    const requestId = randomUUID();
    response.setHeader("x-request-id", requestId);
    setCors(response);

    try {
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
      if (request.method === "GET" && pathname.startsWith("/media/")) {
        const objectKey = pathname.slice("/media/".length);
        const filePath = objectStore.resolve(objectKey);
        const extension = path.extname(filePath).toLowerCase();
        const contentType =
          extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : "image/jpeg";
        await sendFile(response, filePath, contentType);
        return;
      }

      const context = requestContext(request, requireContextHeaders);

      if (request.method === "GET" && pathname === "/api/v1/personas") {
        const items = await service.listPersonas(context.workspaceId);
        sendJson(response, 200, { items, requestId });
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
        const result = await service.createGenerationRequest(
          context.workspaceId,
          await readJson(request),
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
