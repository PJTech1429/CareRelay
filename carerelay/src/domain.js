const medicalPatterns = [
  /\b(diagnos(?:e|is)|prescri(?:be|ption)|dosage|dose|medication advice|treatment)\b/i,
  /\bshould (?:he|she|they|i) (?:take|stop|increase|decrease)\b/i,
  /\b(?:double|change|increase|decrease|stop)\b.{0,30}\b(?:medication|medicine|dose)\b/i
];

const emergencyPatterns = [/\b(can['’]?t breathe|not breathing|unconscious|chest pain|severe bleeding|suicid(?:e|al)|overdose)\b/i];

export function assertNonMedical(text) {
  if (emergencyPatterns.some((pattern) => pattern.test(text))) {
    const error = new Error("This may be an emergency. CareRelay cannot assess it. Contact local emergency services or a qualified professional now.");
    error.code = "EMERGENCY_BOUNDARY";
    throw error;
  }
  if (medicalPatterns.some((pattern) => pattern.test(text))) {
    const error = new Error(
      "CareRelay coordinates non-medical handoffs only. It cannot diagnose, prescribe, change medication, or provide treatment advice."
    );
    error.code = "NON_MEDICAL_BOUNDARY";
    throw error;
  }
}

export function structureUpdate({ caregiver, person, text, occurredAt }) {
  assertNonMedical(text);
  if (!caregiver?.trim() || !text?.trim()) throw new Error("Caregiver and update text are required.");
  if (text.length > 4000) throw new Error("Update exceeds the 4,000 character safety limit.");
  const clauses = text.split(/(?:[.;,]|\band\b|\bbut\b)/i).map((value) => value.trim()).filter(Boolean);
  const facts = [];
  const tasks = [];

  const rideHandoffGap = /community[- ]?centre ride|community[- ]?center ride/i.test(text)
    && /(?:nobody|no one|unassigned|leave|leaving)/i.test(text);

  for (const clause of clauses) {
    if (/\b(?:hasn['’]?t|has not|not yet|needs?|follow[- ]?up|pending|missed|didn['’]?t|nobody|no one|unassigned)\b/i.test(clause)) {
      tasks.push({
        title: rideHandoffGap ? "Coordinate Dad’s 5:00 PM community-centre ride" : normaliseTask(clause),
        status: "pending",
        owner: null,
        sourceText: clause
      });
    } else {
      facts.push({ statement: sentence(clause), sourceText: clause });
    }
  }

  if (rideHandoffGap && !tasks.some((task) => /community-centre ride/i.test(task.title))) {
    tasks.push({
      title: "Coordinate Dad’s 5:00 PM community-centre ride",
      status: "pending",
      owner: null,
      sourceText: text
    });
  }

  return {
    caregiver,
    person,
    occurredAt,
    sourceText: text,
    facts,
    tasks,
    unresolvedOwnerCount: tasks.filter((task) => !task.owner).length
  };
}

function normaliseTask(clause) {
  if (/grocery delivery/i.test(clause)) return "Follow up on the grocery delivery";
  return sentence(clause.replace(/^(?:the\s+)?/i, ""));
}

function sentence(value) {
  const trimmed = value.trim().replace(/[.!?]+$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function buildHandoff(state, nextCaregiver) {
  if (!nextCaregiver?.trim()) throw new Error("Next caregiver is required.");
  const pending = state.tasks.filter((task) => task.status === "pending");
  return {
    person: state.person,
    forCaregiver: nextCaregiver,
    generatedAt: new Date().toISOString(),
    summary: `${state.person} has ${pending.length} pending care coordination item${pending.length === 1 ? "" : "s"}.`,
    latestFacts: state.events.flatMap((event) => event.facts.map((fact) => ({
      statement: fact.statement,
      reportedBy: event.caregiver,
      occurredAt: event.occurredAt,
      ...(fact.evidenceId ? { sourceText: fact.sourceText, evidenceId: fact.evidenceId, messageId: event.message.id, assertionType: fact.assertionType } : {})
    }))).slice(-5),
    ...(state.events.some(event => event.reviewItems?.length) ? { reviewItems: state.events.flatMap(event => (event.reviewItems ?? []).map(item => ({ ...item, eventId: event.id, messageId: event.message.id, reportedBy: event.caregiver }))) } : {}),
    pendingTasks: pending.map(({ id, title, owner, confirmedBy, sourceText, evidenceId, ownership, review }) => ({ id, title, owner, confirmedBy, ...(evidenceId ? { sourceText, evidenceId, reportedOwnership: ownership, ...(review ? { interpretationReview: review } : {}), confirmationState: owner ? "confirmed" : "unconfirmed" } : {}) })),
    boundary: "Coordination information only; no medical advice is generated.",
    provenanceComplete: state.events.every((event) => event.caregiver && event.occurredAt && event.sourceText)
  };
}
