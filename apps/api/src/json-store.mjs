import fs from "node:fs/promises";
import path from "node:path";

/**
 * Small development adapter with atomic replace semantics. Production should use
 * PostgreSQL transactions, but domain services do not depend on this storage type.
 */
export class AtomicJsonFileStore {
  /** @param {string} filePath @param {() => Record<string, any>} initialFactory */
  constructor(filePath, initialFactory) {
    this.filePath = filePath;
    this.initialFactory = initialFactory;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const source = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(source);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return this.initialFactory();
      }
      throw error;
    }
  }

  /** @param {(draft: Record<string, any>) => any | Promise<any>} mutator */
  async mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const draft = await this.read();
      const result = await mutator(draft);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, this.filePath);
      return result;
    });

    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
