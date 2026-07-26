import { createServer } from "node:http";
import { AtomicJsonFileStore } from "./json-store.mjs";
import { loadConfig } from "./config.mjs";
import { createHttpHandler } from "./http.mjs";
import { createCreativeHttpHandler } from "./creative-http.mjs";
import { CreativeService } from "./creative-service.mjs";
import { GenerationDispatchService } from "./generation-dispatch-service.mjs";
import { MediaSigner } from "./media-signer.mjs";
import { LocalObjectStore } from "./object-store.mjs";
import { PersonaService } from "./persona-service.mjs";
import { JsonHubRepository } from "./repositories.mjs";
import { RunpodClient } from "./runpod-client.mjs";

const config = loadConfig();
const store = new AtomicJsonFileStore(config.databaseFile, () => ({
  schemaVersion: 3,
  personas: [],
  references: [],
  personaVersions: [],
  generations: [],
  creativeJobs: [],
}));
const repository = new JsonHubRepository(store);
const objectStore = new LocalObjectStore({
  rootDir: config.objectRoot,
  maxImageBytes: config.maxImageBytes,
});
const mediaSigner = new MediaSigner({
  secret: config.mediaSigningSecret,
  ttlSeconds: config.mediaUrlTtlSeconds,
  maxTtlSeconds: config.mediaMaxUrlTtlSeconds,
});
const personaService = new PersonaService({
  repository,
  objectStore,
  mediaSigner,
  publicOrigin: config.publicOrigin,
});
const runpodClient = new RunpodClient({
  apiKey: process.env.RUNPOD_API_KEY ?? null,
  endpointId: process.env.RUNPOD_ENDPOINT_ID ?? null,
});
const generationDispatcher = new GenerationDispatchService({
  repository,
  personaService,
  runpodClient,
  generationMediaUrlTtlSeconds: config.generationMediaUrlTtlSeconds,
});
const creativeService = new CreativeService({
  repository,
  personaService,
  generationDispatcher,
  publicOrigin: config.publicOrigin,
});
const creativeHandler = createCreativeHttpHandler({
  creativeService,
  generationDispatcher,
  requireContextHeaders: config.requireContextHeaders,
  allowedOrigins: config.allowedOrigins,
});
const baseHandler = createHttpHandler({
  service: personaService,
  objectStore,
  webRoot: config.webRoot,
  requireContextHeaders: config.requireContextHeaders,
  allowedOrigins: config.allowedOrigins,
});
const server = createServer(async (request, response) => {
  if (await creativeHandler(request, response)) return;
  await baseHandler(request, response);
});

server.listen(config.port, () => {
  const runpodState = generationDispatcher.configured ? "Runpod connected" : "Runpod not configured";
  console.log(`Hub v2 listening on ${config.publicOrigin} (${runpodState})`);
});

const shutdown = (signal) => {
  console.log(`Received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
