import { createServer } from "node:http";
import { AtomicJsonFileStore } from "./json-store.mjs";
import { loadConfig } from "./config.mjs";
import { createHttpHandler } from "./http.mjs";
import { MediaSigner } from "./media-signer.mjs";
import { LocalObjectStore } from "./object-store.mjs";
import { PersonaService } from "./persona-service.mjs";
import { JsonHubRepository } from "./repositories.mjs";

const config = loadConfig();
const store = new AtomicJsonFileStore(config.databaseFile, () => ({
  schemaVersion: 2,
  personas: [],
  references: [],
  personaVersions: [],
  generations: [],
}));
const repository = new JsonHubRepository(store);
const objectStore = new LocalObjectStore({
  rootDir: config.objectRoot,
  maxImageBytes: config.maxImageBytes,
});
const mediaSigner = new MediaSigner({
  secret: config.mediaSigningSecret,
  ttlSeconds: config.mediaUrlTtlSeconds,
});
const service = new PersonaService({
  repository,
  objectStore,
  mediaSigner,
  publicOrigin: config.publicOrigin,
});
const server = createServer(
  createHttpHandler({
    service,
    objectStore,
    webRoot: config.webRoot,
    requireContextHeaders: config.requireContextHeaders,
    allowedOrigins: config.allowedOrigins,
  }),
);

server.listen(config.port, () => {
  console.log(`Hub v2 listening on ${config.publicOrigin}`);
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
