import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CareRelayService } from "../src/service.js";
import { JsonStore } from "../src/store.js";
import { acceptExtraction } from "../src/extraction-contract.js";

test("uncertain source is persisted for clarification and cannot be assigned as a task", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carerelay-review-"));
  try {
    const store = new JsonStore(path.join(dir, "state.json"));
    const input = { caregiver: "Asha", person: "Parent", text: "The carpet is blue." };
    const payload = { schemaVersion: 3, people: [], facts: [], shifts: [], responsibilities: [{ evidenceId: "s0", interpretation: "send a parcel", completionClaim: "completed", ownershipClaim: { kind: "explicit", candidates: ["Mallory"] } }] };
    const model = { provider: "offline-test", extract: async source => acceptExtraction(payload, source) };
    const first = new CareRelayService(store, { model });
    const result = await first.recordUpdate(input);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.assignmentPayload, null);
    assert.equal(result.reviewItems.length, 1);
    assert.equal(result.reviewItems[0].owner, null);
    assert.match(result.confirmationPrompt, /Please clarify/);
    assert.equal(result.reviewItems[0].sourceText, input.text);
    await assert.rejects(() => first.requestAssignmentConsent({ taskId: "s0", owner: "Mallory", requestedBy: "Asha" }), /Unknown task/);
    const next = new CareRelayService(new JsonStore(store.filePath), { model });
    const handoff = await next.getHandoff({ nextCaregiver: "Meera" });
    assert.equal(handoff.pendingTasks.length, 0);
    assert.equal(handoff.reviewItems[0].sourceText, input.text);
    assert.equal(handoff.reviewItems[0].review.state, "clarification_required");
    assert.equal(handoff.reviewItems[0].interpretation.verified, false);
    assert.equal((await store.load()).consents.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
