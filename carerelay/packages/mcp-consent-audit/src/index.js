import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export class ConsentLedger {
  constructor({ now = () => new Date().toISOString(), ttlMs = 15 * 60_000, records = [] } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.pending = new Map(records.map((record) => [record.consentId, structuredClone(record)]));
    this.consumed = new Set(records.filter((record) => record.status === "confirmed").map((record) => record.consentId));
  }

  request({ action, actor, subject, payload }) {
    const consentId = randomUUID();
    const requestedAt = this.now();
    const payloadDigest = digest(payload);
    const record = { consentId, action, actor, subject, payloadDigest, requestedAt, status: "pending" };
    this.pending.set(consentId, record);
    return structuredClone(record);
  }

  confirm({ consentId, actor, payload, confirmed }) {
    if (confirmed !== true) throw new ConsentError("EXPLICIT_CONFIRMATION_REQUIRED", "Explicit confirmation is required.");
    const record = this.pending.get(consentId);
    if (!record) throw new ConsentError("CONSENT_NOT_FOUND", "Consent request was not found.");
    if (this.consumed.has(consentId)) throw new ConsentError("CONSENT_ALREADY_USED", "Consent is single-use and has already been consumed.");
    if (Date.parse(this.now()) - Date.parse(record.requestedAt) > this.ttlMs) throw new ConsentError("CONSENT_EXPIRED", "Consent request has expired.");
    if (record.actor !== actor) throw new ConsentError("ACTOR_MISMATCH", "Only the requesting actor may confirm this action.");
    const expected = Buffer.from(record.payloadDigest);
    const actual = Buffer.from(digest(payload));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ConsentError("PAYLOAD_CHANGED", "The action changed after consent was requested.");
    this.consumed.add(consentId);
    record.status = "confirmed";
    record.confirmedAt = this.now();
    return structuredClone(record);
  }
}

export class AppendOnlyAuditLog {
  constructor({ now = () => new Date().toISOString(), entries = [] } = {}) {
    this.now = now;
    this.entries = structuredClone(entries);
    if (!this.verify()) throw new Error("Existing audit chain failed integrity verification.");
  }

  append({ action, actor, subject, provenance = [], metadata = {} }) {
    const previousHash = this.entries.at(-1)?.hash ?? "GENESIS";
    const entry = { sequence: this.entries.length + 1, at: this.now(), action, actor, subject, provenance, metadata, previousHash };
    entry.hash = digest(entry);
    this.entries.push(Object.freeze(entry));
    return structuredClone(entry);
  }

  verify() {
    return this.entries.every((entry, index) => {
      const previousHash = index === 0 ? "GENESIS" : this.entries[index - 1].hash;
      const { hash, ...unsigned } = entry;
      return entry.previousHash === previousHash && digest(unsigned) === hash;
    });
  }

  export() { return structuredClone(this.entries); }
}

export class ConsentError extends Error {
  constructor(code, message) { super(message); this.name = "ConsentError"; this.code = code; }
}

export function provenance({ sourceType, sourceId, actor, capturedAt, excerpt }) {
  if (!sourceType || !sourceId || !actor || !capturedAt) throw new Error("Complete provenance is required.");
  return Object.freeze({ sourceType, sourceId, actor, capturedAt, excerpt });
}

function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
