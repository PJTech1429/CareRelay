import { createHash } from "node:crypto";
import { assertNonMedical } from "./domain.js";

// This is a proposal boundary, not a general-purpose language parser. Uncertain
// semantics stay visible for review; model text never becomes quoted evidence.
export const CONTRACT_VERSION = "care-relay-extraction-v3";
export const PROPOSAL_POLICY = "evidence-first-review-v1";
const string = { type: "string", minLength: 1, maxLength: 1000 };
const nullableString = { anyOf: [string, { type: "null" }] };
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = items => ({ type: "array", maxItems: 32, items });
export const EXTRACTION_SCHEMA = object({
  schemaVersion: { const: 3 },
  people: array(object({ name: string, evidenceId: string })),
  facts: array(object({ evidenceId: string })),
  responsibilities: array(object({
    evidenceId: string, interpretation: string,
    completionClaim: { enum: ["pending", "completed", "uncertain"] },
    ownershipClaim: object({ kind: { enum: ["missing", "ambiguous", "explicit", "offered", "uncertain"] }, candidates: array(string) })
  })),
  shifts: array(object({ evidenceId: string, caregiver: string, startsAt: nullableString, endsAt: nullableString }))
});

export class ExtractionError extends Error {
  constructor(code, message) { super(message); this.name = "ExtractionError"; this.code = code; }
}
function fail(code, message) { throw new ExtractionError(code, message); }

export function createEnvelope(input) {
  if (typeof input?.text !== "string" || !input.text.trim() || input.text.length > 4000) fail("INVALID_INPUT", "A message of 1–4,000 characters is required.");
  if (typeof input.caregiver !== "string" || !input.caregiver.trim()) fail("INVALID_INPUT", "Reporting caregiver metadata is required.");
  assertNonMedical(input.text);
  // Reject common instruction attacks before extraction, without claiming full
  // prompt-injection detection. Unknown attacks still meet the evidence gate.
  if (/\b(ignore|override|disregard)\b.{0,70}\b(instructions|rules|system|consent)\b|\b(system|assistant)\s*:|\b(?:forge|fabricate)\b.{0,30}\b(consent|confirmation)\b/i.test(input.text)) {
    fail("INSTRUCTION_BOUNDARY", "Model-control instructions are outside caregiver coordination.");
  }
  const id = createHash("sha256").update(input.text).digest("hex");
  const evidence = [];
  // Keep complete sentences including negation/modality. Do not split at decimal
  // points or punctuation without following whitespace.
  for (const match of input.text.matchAll(/[^.!?\n]+(?:[.!?](?!\s|$)[^.!?\n]*)*(?:[.!?](?=\s|$)|$)/g)) {
    const quote = match[0].trim();
    if (!quote) continue;
    const start = match.index + match[0].indexOf(quote);
    evidence.push({ id: `s${evidence.length}`, messageId: id, start, end: start + quote.length, quote });
  }
  if (!evidence.length) evidence.push({ id: "s0", messageId: id, start: 0, end: input.text.length, quote: input.text });
  return { message: { id, text: input.text }, speakerMetadata: { caregiver: input.caregiver, person: input.person ?? null, occurredAt: input.occurredAt ?? null, source: "caller_supplied_metadata" }, evidence };
}

function validate(value, schema, location = "response") {
  if (schema.const !== undefined && value !== schema.const) fail("INVALID_SCHEMA", `${location}: invalid contract version.`);
  if (schema.enum && !schema.enum.includes(value)) fail("INVALID_SCHEMA", `${location}: invalid enum.`);
  if (schema.anyOf) {
    if (value === null) return;
    return validate(value, string, location);
  }
  if (schema.type === "string" && (typeof value !== "string" || !value.trim() || value.length > 1000)) fail("INVALID_SCHEMA", `${location}: invalid string.`);
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 32) fail("INVALID_SCHEMA", `${location}: invalid array.`);
    value.forEach((item, index) => validate(item, schema.items, `${location}[${index}]`));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_SCHEMA", `${location}: invalid object.`);
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) fail("INVALID_SCHEMA", `${location}: unexpected field.`);
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) fail("INVALID_SCHEMA", `${location}.${key}: required field missing.`);
      validate(value[key], schema.properties[key], `${location}.${key}`);
    }
  }
}

function literalEvidence(quote, envelope) {
  if (typeof quote !== "string" || !quote.trim() || !envelope.message.text.includes(quote)) fail("UNSUPPORTED_PROVENANCE", "Quote is not an exact substring of the original message.");
  const start = envelope.message.text.indexOf(quote);
  return { id: `q${start}-${quote.length}`, messageId: envelope.message.id, start, end: start + quote.length, quote };
}
function nullable(value) { return value == null || value === "null" ? null : value; }
function containsName(text, name) {
  if (typeof name !== "string" || !name.trim()) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function contextFor(evidence, envelope) {
  const containing = envelope.evidence.filter(part => part.start < evidence.end && part.end > evidence.start);
  return containing.length ? containing.map(part => part.quote).join(" ") : evidence.quote;
}
const negated = /\b(?:not|never|neither|nobody|no one|none|unassigned|without)\b|n['’]t\b/i;
const future = /\b(?:will|shall|can|could|may|might|would|tomorrow|later|plan|plans|planning|promise|promised|promises|offer|offered|offers|going to|intend|intends)\b|['’]ll\b/i;
const uncertain = /\b(?:if|unless|whether|wish|wishes|said|says|heard|thought|thinks|supposed|maybe|perhaps)\b|[?"“”]/i;
const completedAssertion = /\b(?:I|we|he|she|they|[\p{L}]+)\s+(?:(?:have|has|had)\s+)?(?:already\s+|just\s+)?(?:completed|finished|returned|delivered|collected|watered|cleaned|locked|unlocked|paid|sent|brought|took|fed|washed|received|booked|cancelled|canceled|packed|repaired|checked|called|did)\b|\b(?:has|have|was|were|is)\s+(?:already\s+)?(?:completed|finished|done|delivered|returned|paid|locked)\b/iu;
// Recognize responsibility *frames*, never an action-verb allowlist. These are
// routing hints, not proof of semantic entailment. Anything else is preserved
// for clarification without creating an assignable task.
function responsibilityFrame(context) {
  const modal = /\b(?:will|shall|can|could|may|might|must|would|should)\s+(?:not\s+)?(?!be\b|seem\b|exist\b)[\p{L}]+\b|['’]ll\s+(?!be\b)[\p{L}]+\b/iu;
  const intent = /\b(?:plan(?:s|ned|ning)?|promis(?:e|es|ed)|offer(?:s|ed)?|intend(?:s|ed)?)\s+to\s+[\p{L}]+\b/iu;
  const obligation = /\b(?:needs?|requires?|required|pending)\b|\b(?:assigned|agreed)\s+to\b|\bresponsible for\b/iu;
  const inquiryOrNegatedAction = /\b(?:did|didn't|didn’t|hasn't|hasn’t|haven't|haven’t|hadn't|hadn’t)\b|\b(?:have|has|had)\s+(?:not|never|yet)\b|\bnever\s+[\p{L}]+ed\b/iu;
  const politeRequest = /^please\s+[\p{L}]+\b/iu;
  return modal.test(context) || intent.test(context) || obligation.test(context) || inquiryOrNegatedAction.test(context) || politeRequest.test(context);
}

// A deliberately conservative English assertion grammar. This can abstain; it
// must never equate an LLM's completed label with operational task completion.
function temporalState(context) {
  if (/^(?:please\s+)?(?:do not|don't|must not|never)\b/i.test(context)) return "prohibited";
  if (negated.test(context) || future.test(context)) return "pending";
  if (uncertain.test(context)) return "uncertain";
  if (/\b(?:and|but|while|because|after|before)\b|[,;]/i.test(context)) return "uncertain";
  return completedAssertion.test(context) ? "reported_complete" : "uncertain";
}

function ownership(row, context, envelope) {
  let names = [...new Set(row.candidates ?? [])];
  names = [...new Set(names.map(name => /^(I|my)$/i.test(name) && /\bI\b|\bmy\b/i.test(context) ? envelope.speakerMetadata.caregiver : name))];
  names = names.filter(name => containsName(context, name) || (name === envelope.speakerMetadata.caregiver && /\bI\b/.test(context)));
  const absent = /\b(?:nobody|no one|unassigned|no owner)\b/i.test(context);
  const alternatives = /\bor\b|\beither\b|\bneither\b/i.test(context) && names.length > 1;
  let kind;
  if (alternatives) kind = "ambiguous";
  else if (absent || !names.length || negated.test(context)) kind = "missing";
  else if (names.length > 1) kind = "ambiguous";
  else {
    // Require a binding between this particular name (or speaker I) and the
    // commitment. Another person's "will" elsewhere cannot establish ownership.
    const subject = names[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subjects = names[0] === envelope.speakerMetadata.caregiver ? `(?:${subject}|I)` : subject;
    const committed = new RegExp(`\\b${subjects}\\s+(?:will|shall|promises? to|promised to|has agreed to|is responsible for|is assigned to|owns|is handling)\\b`, "i").test(context);
    const tentative = /\b(?:can|could|may|might|offer|offered|offers)\b/i.test(context);
    kind = committed ? "explicit" : tentative ? "offered" : "uncertain";
  }
  return { kind, candidates: names, proposedOwner: ["explicit", "offered"].includes(kind) && names.length === 1 ? names[0] : null, commitment: "reported_in_message", confirmation: "required" };
}

// Bounded literal shift grammar: subject + boundary verb + exact clock span.
// This is source recovery, not model accuracy, and never fills inferred times.
export function explicitShiftEvidence(input) {
  const envelope = createEnvelope(input), shifts = [];
  const clock = "(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s*[AP]M)?|(?:1[0-2]|0?[1-9])\\s*[AP]M";
  const frame = new RegExp(`\\b(I|[Mm]y(?:\\s+[\\p{L}]+)?\\s+shift|[\\p{Lu}][\\p{L}]+(?:['’]s(?:\\s+[\\p{L}]+)?\\s+shift)?)\\s+(leave|leaves|arrive|arrives|start|starts|end|ends)\\s+at\\s+(${clock})(?![\\p{L}\\d:])`, "gu");
  for (const e of envelope.evidence) {
    // Conditional/quoted boundaries are not an asserted schedule.
    if (/\b(?:if|unless|maybe|perhaps|might|may|could|not|never)\b|[?"“”]/i.test(e.quote)) continue;
    for (const match of e.quote.matchAll(frame)) {
      const firstPerson = /^(I|my\b)/i.test(match[1]);
      const caregiver = firstPerson ? input.caregiver : match[1].replace(/['’]s.*$/, "");
      // Capitalization alone cannot turn a bus/parcel/object into a caregiver.
      if (!firstPerson && caregiver !== input.caregiver && !/['’]s.*\bshift$/.test(match[1])) continue;
      const end = /^(leave|leaves|end|ends)$/.test(match[2]);
      shifts.push({ caregiver, startsAt: end ? null : match[3], endsAt: end ? match[3] : null,
        sourceText: e.quote, evidenceId: e.id, interpretation: true,
        derivation: "literal_shift_boundary", ...(firstPerson ? { speakerBinding: "caller_supplied_metadata" } : {}) });
    }
  }
  return shifts;
}

// Offline legacy replay is explicit. Legacy output is never accepted on the new
// live wire contract. Quotes are not repaired or replaced by metadata.
export function adaptLegacyResponse(raw, input) {
  const envelope = createEnvelope(input);
  for (const key of ["people", "facts", "responsibilities", "shifts", "unresolvedOwnership"]) {
    if (!Array.isArray(raw?.[key])) fail("INVALID_SCHEMA", "Bedrock returned an invalid CareRelay schema.");
  }
  const diagnostics = [];
  const evidenceFor = item => literalEvidence(item.sourceText, envelope);
  const people = [];
  for (const item of raw.people) {
    if (item.name === input.caregiver && !containsName(input.text, item.name)) {
      diagnostics.push({ code: "SPEAKER_METADATA_NOT_MESSAGE_QUOTE", field: "people", value: item.name });
      continue;
    }
    const evidence = evidenceFor(item);
    if (!containsName(evidence.quote, item.name)) fail("UNSUPPORTED_PERSON", "Person name lacks message evidence.");
    people.push({ name: item.name, evidence });
  }
  const facts = raw.facts.map(item => ({ evidence: evidenceFor(item), interpretation: item.statement }));
  const responsibilities = raw.responsibilities.map(item => {
    if (!["pending", "completed", "uncertain"].includes(item.status)) fail("INVALID_SCHEMA", "Unknown completion status.");
    const owner = nullable(item.ownerMention);
    if (owner !== null && typeof owner !== "string") fail("INVALID_SCHEMA", "Invalid owner mention.");
    return { evidence: evidenceFor(item), interpretation: item.title, completionClaim: item.status, candidates: owner ? owner.split(/\s+or\s+|\s+and\s+|\//i).map(x => x.trim()) : [] };
  });
  const shifts = [];
  for (const item of raw.shifts) {
    if (!nullable(item.startsAt) && !nullable(item.endsAt)) {
      diagnostics.push({ code: "EMPTY_SHIFT_DISCARDED" }); continue;
    }
    shifts.push({ ...item, startsAt: nullable(item.startsAt), endsAt: nullable(item.endsAt), evidence: evidenceFor(item) });
  }
  return project({ people, facts, responsibilities, shifts }, envelope, input, diagnostics, "legacy-v2-replay");
}

export function acceptExtraction(raw, input) {
  const envelope = createEnvelope(input);
  validate(raw, EXTRACTION_SCHEMA);
  const resolve = id => {
    const evidence = envelope.evidence.find(item => item.id === id);
    if (!evidence) fail("UNSUPPORTED_PROVENANCE", "Unknown message evidence ID.");
    return evidence;
  };
  const rows = {
    people: raw.people.map(item => ({ name: item.name, evidence: resolve(item.evidenceId) })),
    facts: raw.facts.map(item => ({ evidence: resolve(item.evidenceId), interpretation: null })),
    responsibilities: raw.responsibilities.map(item => ({ ...item, evidence: resolve(item.evidenceId), candidates: item.ownershipClaim.candidates })),
    shifts: raw.shifts.map(item => ({ ...item, evidence: resolve(item.evidenceId) }))
  };
  return project(rows, envelope, input, [], CONTRACT_VERSION);
}

function project(rows, envelope, input, diagnostics, wireContract) {
  const facts = [], tasks = [], reviewItems = [], people = [], shifts = [], evidence = new Map();
  const remember = item => { evidence.set(item.id, item); return item.id; };
  const addFact = row => {
    remember(row.evidence);
    if (!facts.some(item => item.sourceText === row.evidence.quote)) facts.push({
      statement: row.evidence.quote, sourceText: row.evidence.quote,
      evidenceId: row.evidence.id, assertionType: "caregiver_report",
      interpretation: { text: row.interpretation, verified: false }, relevantTime: null
    });
  };
  for (const row of rows.people) {
    if (!containsName(row.evidence.quote, row.name)) {
      if (row.name === input.caregiver) { diagnostics.push({ code: "SPEAKER_METADATA_NOT_MESSAGE_QUOTE" }); continue; }
      fail("UNSUPPORTED_PERSON", "Person name lacks message evidence.");
    }
    remember(row.evidence); people.push({ name: row.name, sourceText: row.evidence.quote, evidenceId: row.evidence.id });
  }
  rows.facts.forEach(addFact);
  for (const row of rows.responsibilities) {
    const context = contextFor(row.evidence, envelope);
    const temporal = temporalState(context);
    remember(row.evidence);
    if (temporal === "reported_complete") {
      addFact(row); diagnostics.push({ code: "REPORTED_COMPLETION_ONLY", evidenceId: row.evidence.id }); continue;
    }
    if (temporal === "prohibited") {
      fail("UNSUPPORTED_RESPONSIBILITY", "An explicit prohibition cannot become a positive responsibility.");
    }
    if (row.completionClaim === "completed") diagnostics.push({ code: "UNSUPPORTED_COMPLETION_OVERRIDDEN", evidenceId: row.evidence.id });
    const owner = ownership(row, context, envelope);
    if (row.ownershipClaim && row.ownershipClaim.kind !== owner.kind) diagnostics.push({ code: "OWNERSHIP_INTERPRETATION_CONFLICT", evidenceId: row.evidence.id, modelKind: row.ownershipClaim.kind, sourceKind: owner.kind });
    if ((row.candidates ?? []).some(name => !owner.candidates.includes(name))) diagnostics.push({ code: "UNSUPPORTED_OWNER_DISCARDED", evidenceId: row.evidence.id });
    if (!responsibilityFrame(context)) {
      reviewItems.push({
        sourceText: row.evidence.quote, evidenceId: row.evidence.id,
        proposedResponsibility: true, owner: null,
        review: { state: "clarification_required", reason: "action_interpretation_uncertain", prompt: `Does “${row.evidence.quote}” describe unfinished work? Please clarify the action and who should own it.` },
        interpretation: { text: row.interpretation, completionClaim: row.completionClaim, temporal, ownership: owner, verified: false }
      });
      diagnostics.push({ code: "RESPONSIBILITY_REVIEW_REQUIRED", evidenceId: row.evidence.id });
      continue;
    }
    tasks.push({
      // The UI and handoff display the source, not a potentially invented title.
      title: row.evidence.quote, sourceText: row.evidence.quote, evidenceId: row.evidence.id,
      status: "pending", owner: null, proposedOwner: owner.proposedOwner,
      ownership: owner, relevantTime: null, requiresInterpretationReview: true,
      review: { state: temporal === "uncertain" || uncertain.test(context) || owner.kind !== "explicit" ? "clarification_required" : "awaiting_confirmation", reason: temporal === "uncertain" || uncertain.test(context) ? "action_interpretation_uncertain" : owner.kind !== "explicit" ? "ownership_requires_review" : "explicit_consent_required" },
      interpretation: { text: row.interpretation, completionClaim: row.completionClaim, temporal, verified: false }
    });
  }
  for (const row of rows.shifts) {
    const text = row.evidence.quote;
    if (!row.startsAt && !row.endsAt) { diagnostics.push({ code: "EMPTY_SHIFT_DISCARDED" }); continue; }
    const bound = containsName(text, row.caregiver) || /\bI\b|\bmy\b/i.test(text);
    const cue = /\b(?:shift|leave|leaves|leaving|arrive|arrives|start|starts|ends)\b/i.test(text);
    if (!bound || !cue || [row.startsAt, row.endsAt].some(time => time !== null && (typeof time !== "string" || !text.includes(time)))) fail("UNSUPPORTED_SHIFT", "Shift boundary lacks exact message evidence.");
    remember(row.evidence);
    const caregiver = containsName(text, row.caregiver) ? row.caregiver : input.caregiver;
    shifts.push({ caregiver, startsAt: row.startsAt, endsAt: row.endsAt, sourceText: text, evidenceId: row.evidence.id, interpretation: true, ...(caregiver === input.caregiver ? { speakerBinding: "caller_supplied_metadata" } : {}) });
  }
  // Preserve clearly stated boundaries even when the model omits the shifts array.
  for (const recovered of explicitShiftEvidence(input)) {
    const exists = shifts.some(s => s.evidenceId === recovered.evidenceId && s.caregiver === recovered.caregiver && s.startsAt === recovered.startsAt && s.endsAt === recovered.endsAt);
    if (!exists) {
      const contradictory = shifts.some(s => s.evidenceId === recovered.evidenceId && s.caregiver === recovered.caregiver && ((s.startsAt && recovered.startsAt && s.startsAt !== recovered.startsAt) || (s.endsAt && recovered.endsAt && s.endsAt !== recovered.endsAt)));
      if (contradictory) fail("UNSUPPORTED_SHIFT", "Model shift conflicts with the explicit source boundary.");
      shifts.push(recovered);
      remember(envelope.evidence.find(e => e.id === recovered.evidenceId));
      diagnostics.push({ code: "EXPLICIT_SHIFT_RECOVERED", evidenceId: recovered.evidenceId });
    }
  }
  return {
    ...input, sourceText: input.text, contractVersion: CONTRACT_VERSION, wireContract, proposalPolicy: PROPOSAL_POLICY,
    message: envelope.message, speakerMetadata: envelope.speakerMetadata,
    evidence: [...evidence.values()], people, facts, tasks, reviewItems, shifts,
    responsibilities: tasks.map(task => ({ title: task.title, status: task.status, ownerMention: task.proposedOwner, sourceText: task.sourceText, ownership: task.ownership })),
    unresolvedOwnership: tasks.flatMap((task, responsibilityIndex) => ["missing", "ambiguous"].includes(task.ownership.kind) ? [{ responsibilityIndex, reason: `${task.ownership.kind}_owner` }] : []),
    unresolvedOwnerCount: tasks.length, diagnostics,
    extractionStatus: reviewItems.length ? "clarification_required" : tasks.length ? "interpretation_requires_confirmation" : "sourced_reports_recorded"
  };
}
