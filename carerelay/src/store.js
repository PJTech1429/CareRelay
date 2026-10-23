import { readFile } from "node:fs/promises";

export class JsonStore {
  constructor(filePath, fileOptions = {}) {
    this.filePath = filePath;
    this.fileOptions = fileOptions;
  }

  async load() {
    try {
      return { ...initialState(), ...JSON.parse(await readFile(this.filePath, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return initialState();
    }
  }

  async save(state) {
    // Load lazily: the existing WindowsJsonStore adapter extends this class.
    // Reuse its bounded atomic-file helper for every local store, including legacy flows.
    // Only a transient file rename is retried; never replay a transaction or model call.
    const { atomicWriteFile } = await import("./final-kimi/atomic-file.js");
    await atomicWriteFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, this.fileOptions);
  }

  async reset() {
    const state = initialState();
    await this.save(state);
    return state;
  }
}

function initialState() {
  return { schemaVersion: 1, person: "Dad", events: [], tasks: [], audit: [], consents: [] };
}
