import { randomUUID } from "node:crypto";
import { assertNonMedical, buildHandoff } from "./domain.js";
import { AppendOnlyAuditLog, ConsentLedger, provenance } from "../packages/mcp-consent-audit/src/index.js";
import { LocalDeterministicModel } from "./model.js";

export class CareRelayService {
  constructor(store, { model = new LocalDeterministicModel(), consent = new ConsentLedger(), audit = new AppendOnlyAuditLog() } = {}) {
    this.store = store;
    this.model = model;
    this.consent = consent;
    this.audit = audit;
  }

  async recordUpdate(input) {
    assertNonMedical(input.text ?? "");
    const update = await this.model.extract({
      caregiver: input.caregiver,
      person: input.person ?? "Dad",
      text: input.text,
      occurredAt: input.occurredAt ?? new Date().toISOString()
    });
    const state = await this.store.load();
    state.person = update.person;
    const eventId = randomUUID();
    const tasks = update.tasks.map((task) => ({ ...task, id: randomUUID(), eventId }));
    state.events.push({ ...update, id: eventId, tasks: tasks.map((task) => task.id) });
    state.tasks.push(...tasks);
    this.audit = new AppendOnlyAuditLog({ entries: state.audit });
    const source = provenance({ sourceType: "caregiver_statement", sourceId: eventId, actor: input.caregiver, capturedAt: update.occurredAt, excerpt: input.text.slice(0, 240) });
    state.audit.push(this.audit.append({ action: "caregiver_update_recorded", actor: input.caregiver, subject: update.person, provenance: [source], metadata: { eventId, modelProvider: this.model.provider } }));
    await this.store.save(state);
    const assignmentPayload = tasks[0] ? { taskId: tasks[0].id, owner: null } : null;
    return {
      eventId,
      facts: update.facts,
      tasks,
      unresolvedOwnerCount: tasks.filter((task) => !task.owner).length,
      confirmationPrompt: tasks.length
        ? `Who should own: ${tasks[0].title}? No assignment will occur without confirmation.`
        : update.reviewItems?.[0]?.review.prompt ?? null,
      assignmentPayload,
      ...(update.contractVersion ? { contractVersion: update.contractVersion, proposalPolicy: update.proposalPolicy, message: update.message, speakerMetadata: update.speakerMetadata, evidence: update.evidence, reviewItems: update.reviewItems ?? [], extractionStatus: update.extractionStatus, diagnostics: update.diagnostics } : {}),
      modelProvider: this.model.provider
    };
  }

  async requestAssignmentConsent({ taskId, owner, requestedBy }) {
    const state = await this.store.load();
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    this.audit = new AppendOnlyAuditLog({ entries: state.audit });
    const payload = { taskId, owner };
    const consent = this.consent.request({ action: "assign_task", actor: requestedBy, subject: taskId, payload });
    state.consents.push(consent);
    state.audit.push(this.audit.append({ action: "assignment_consent_requested", actor: requestedBy, subject: taskId, metadata: { consentId: consent.consentId, owner } }));
    await this.store.save(state);
    return { ...consent, payload, prompt: `Confirm assigning “${task.title}” to ${owner}?` };
  }

  async confirmAssignment({ consentId, taskId, owner, confirmedBy, confirmed }) {
    const state = await this.store.load();
    this.consent = new ConsentLedger({ records: state.consents });
    this.consent.confirm({ consentId, actor: confirmedBy, payload: { taskId, owner }, confirmed });
    this.audit = new AppendOnlyAuditLog({ entries: state.audit });
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    task.owner = owner;
    task.confirmedBy = confirmedBy;
    task.confirmedAt = new Date().toISOString();
    const persistedConsent = state.consents.find((item) => item.consentId === consentId);
    if (persistedConsent) { persistedConsent.status = "confirmed"; persistedConsent.confirmedAt = task.confirmedAt; }
    state.audit.push(this.audit.append({ action: "task_assignment_confirmed", actor: confirmedBy, subject: taskId, metadata: { consentId, owner } }));
    await this.store.save(state);
    return { assigned: true, task };
  }

  async getHandoff({ nextCaregiver }) {
    const state = await this.store.load();
    this.audit = new AppendOnlyAuditLog({ entries: state.audit });
    const result = buildHandoff(state, nextCaregiver);
    state.audit.push(this.audit.append({ action: "handoff_generated", actor: "system", subject: state.person, metadata: { nextCaregiver } }));
    await this.store.save(state);
    return result;
  }

  async getAudit() {
    const state = await this.store.load();
    return { entries: state.audit, consentRecords: state.consents, eventCount: state.events.length, taskCount: state.tasks.length };
  }

  async health() { return { service: "carerelay", status: "ready", model: await this.model.health(), boundary: "non-medical" }; }
}
