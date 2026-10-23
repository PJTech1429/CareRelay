import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.js";
import { CareRelayService } from "../src/service.js";
import { McpHandler, PROTOCOL_VERSION } from "../src/mcp.js";

async function harness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "carerelay-"));
  const file = path.join(directory, "state.json");
  const handler = new McpHandler(new CareRelayService(new JsonStore(file)));
  const sessionId = handler.createSession();
  await handler.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION } }, sessionId);
  await handler.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
  return { handler, sessionId, file };
}

test("realistic caregiver flow persists and produces a later handoff", async () => {
  const { handler, sessionId, file } = await harness();
  const update = await handler.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "record_caregiver_update", arguments: { caregiver: "Priya", person: "Dad", occurredAt: "2026-09-18T09:00:00Z", text: "Dad ate lunch, but the grocery delivery hasn't arrived" } } }, sessionId);
  const result = update.response.result.structuredContent;
  assert.equal(result.facts[0].statement, "Dad ate lunch");
  assert.equal(result.unresolvedOwnerCount, 1);
  assert.equal(result.tasks[0].owner, null);

  const taskId = result.tasks[0].id;
  const consent = await handler.callTool("request_task_assignment_consent", { taskId, owner: "Meera", requestedBy: "Priya" });
  const assignment = await handler.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "confirm_task_assignment", arguments: { consentId: consent.consentId, taskId, owner: "Meera", confirmedBy: "Priya", confirmed: true } } }, sessionId);
  assert.equal(assignment.response.result.structuredContent.task.owner, "Meera");

  const handoff = await handler.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_caregiver_handoff", arguments: { nextCaregiver: "Meera" } } }, sessionId);
  assert.equal(handoff.response.result.structuredContent.forCaregiver, "Meera");
  assert.equal(handoff.response.result.structuredContent.pendingTasks[0].owner, "Meera");
  assert.match(handoff.response.result.structuredContent.boundary, /no medical advice/i);

  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.events.length, 1);
  assert.equal(persisted.tasks[0].owner, "Meera");
  assert.equal(persisted.audit.length, 4);
});

test("assignment cannot happen without explicit confirmation", async () => {
  const { handler, sessionId } = await harness();
  const update = await handler.callTool("record_caregiver_update", { caregiver: "Priya", text: "The grocery delivery hasn't arrived" });
  const consent = await handler.callTool("request_task_assignment_consent", { taskId: update.tasks[0].id, owner: "Meera", requestedBy: "Priya" });
  await assert.rejects(() => handler.callTool("confirm_task_assignment", { consentId: consent.consentId, taskId: update.tasks[0].id, owner: "Meera", confirmedBy: "Priya", confirmed: false }), /Explicit confirmation/);
});

test("medical advice is rejected", async () => {
  const { handler } = await harness();
  await assert.rejects(() => handler.callTool("record_caregiver_update", { caregiver: "Priya", text: "Should he increase his medication dose?" }), (error) => error.code === "NON_MEDICAL_BOUNDARY");
});

test("approved judge scenario detects the cross-shift ownership gap", async () => {
  const { handler } = await harness();
  const result = await handler.callTool("record_caregiver_update", {
    caregiver: "Priya",
    person: "Dad",
    occurredAt: "2026-09-19T09:00:00Z",
    text: "Dad ate lunch. His community-centre ride is at 5:00 PM, but I leave at 4:30 PM and nobody is assigned to help him get ready."
  });
  assert.equal(result.unresolvedOwnerCount, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "Coordinate Dad’s 5:00 PM community-centre ride");
  assert.equal(result.facts.some((fact) => /ate lunch/i.test(fact.statement)), true);
  assert.equal(result.facts.some((fact) => /ride is at 5:00 PM/i.test(fact.statement)), true);
});

test("approved judge safety question is refused", async () => {
  const { handler } = await harness();
  await assert.rejects(
    () => handler.callTool("record_caregiver_update", { caregiver: "Meera", person: "Dad", text: "Should Dad double his medication tonight?" }),
    (error) => error.code === "NON_MEDICAL_BOUNDARY"
  );
});
