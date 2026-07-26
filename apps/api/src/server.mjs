import { createServer } from "node:http";
import { AtomicJsonFileStore } from "./json-store.mjs";
import { loadConfig } from "./config.mjs";
import { createHttpHandler } from "./http.mjs";
import { LocalObjectStore } from "./object-store.mjs";
import { PersonaService } from "./persona-service.mjs";
import { JsonHubRepository } from "./repositories.mjs";

const config = loadConfig();
const store = new AtomicJsonFileStore(config.databaseFile, () => ({
  schemaVersion: 1,
  personas: [],
  references: [],
  generations: [],
}));
const repository = new JsonHubRepository(store);
const objectStore = new LocalObjectStore({
  rootDir: config.objectRoot,
  maxImageBytes: config.maxImageBytes,
});
const service = new PersonaService({
  repository,
  objectStore,
  publicOrigin: config.publicOrigin,
});
const server = createServer(
  createHttpHandler({
    service,
    objectStore,
    webRoot: config.webRoot,
    requireContextHeaders: config.requireContextHeaders,
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
