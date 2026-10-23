import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("MCP 2025-11-25 lifecycle works over Streamable HTTP", async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const initialize = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) });
  assert.equal(initialize.status, 200);
  assert.equal((await initialize.json()).result.protocolVersion, "2025-11-25");
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Session-Id": sessionId, "MCP-Protocol-Version": "2025-11-25" };
  const ready = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(ready.status, 202);
  const listed = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal((await listed.json()).result.tools.length, 6);
  const get = await fetch(endpoint, { headers: { Accept: "text/event-stream" } });
  assert.equal(get.status, 405);
});

test("Streamable HTTP rejects hostile origins", async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 403);
});

test("a new caregiver MCP session receives state confirmed in the prior session", async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const openSession = async () => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) });
    const id = response.headers.get("mcp-session-id");
    const headers = { "Content-Type": "application/json", "MCP-Session-Id": id, "MCP-Protocol-Version": "2025-11-25" };
    await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    return { id, headers };
  };
  const invoke = async (headers, id, name, args) => {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) });
    return (await response.json()).result.structuredContent;
  };
  await fetch(`http://127.0.0.1:${server.address().port}/api/reset`, { method: "POST" });
  const priya = await openSession();
  const update = await invoke(priya.headers, 2, "record_caregiver_update", { caregiver: "Priya", person: "Dad", text: "Dad ate lunch. His community-centre ride is at 5:00 PM, but I leave at 4:30 PM and nobody is assigned." });
  const consent = await invoke(priya.headers, 3, "request_task_assignment_consent", { taskId: update.tasks[0].id, owner: "Meera", requestedBy: "Priya" });
  await invoke(priya.headers, 4, "confirm_task_assignment", { consentId: consent.consentId, taskId: update.tasks[0].id, owner: "Meera", confirmedBy: "Priya", confirmed: true });
  assert.equal((await fetch(endpoint, { method: "DELETE", headers: priya.headers })).status, 204);
  const meera = await openSession();
  assert.notEqual(meera.id, priya.id);
  const handoff = await invoke(meera.headers, 5, "get_caregiver_handoff", { nextCaregiver: "Meera" });
  assert.equal(handoff.pendingTasks[0].owner, "Meera");
  assert.equal(handoff.provenanceComplete, true);
});
