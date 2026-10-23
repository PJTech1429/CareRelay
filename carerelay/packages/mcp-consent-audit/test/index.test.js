import test from "node:test";
import assert from "node:assert/strict";
import { AppendOnlyAuditLog, ConsentLedger, provenance } from "../src/index.js";

test("consent is actor-bound, payload-bound and single-use", () => {
  const ledger = new ConsentLedger({ now: () => "2026-09-18T10:00:00Z" });
  const payload = { taskId: "t-1", owner: "Meera" };
  const pending = ledger.request({ action: "assign_task", actor: "Priya", subject: "t-1", payload });
  assert.throws(() => ledger.confirm({ consentId: pending.consentId, actor: "Other", payload, confirmed: true }), { code: "ACTOR_MISMATCH" });
  assert.throws(() => ledger.confirm({ consentId: pending.consentId, actor: "Priya", payload: { ...payload, owner: "Someone else" }, confirmed: true }), { code: "PAYLOAD_CHANGED" });
  assert.equal(ledger.confirm({ consentId: pending.consentId, actor: "Priya", payload, confirmed: true }).status, "confirmed");
  assert.throws(() => ledger.confirm({ consentId: pending.consentId, actor: "Priya", payload, confirmed: true }), { code: "CONSENT_ALREADY_USED" });
});

test("audit chain verifies provenance", () => {
  const audit = new AppendOnlyAuditLog({ now: () => "2026-09-18T10:00:00Z" });
  const source = provenance({ sourceType: "caregiver_statement", sourceId: "event-1", actor: "Priya", capturedAt: "2026-09-18T09:00:00Z", excerpt: "Dad ate lunch" });
  audit.append({ action: "fact_recorded", actor: "Priya", subject: "Dad", provenance: [source] });
  audit.append({ action: "handoff_generated", actor: "system", subject: "Dad" });
  assert.equal(audit.verify(), true);
  assert.equal(audit.export().length, 2);
});

test("expired consent is rejected",()=>{
  let time="2026-09-18T10:00:00Z";const ledger=new ConsentLedger({now:()=>time,ttlMs:1000});const payload={taskId:"t"};const pending=ledger.request({action:"assign",actor:"Priya",subject:"t",payload});time="2026-09-18T10:00:02Z";assert.throws(()=>ledger.confirm({consentId:pending.consentId,actor:"Priya",payload,confirmed:true}),{code:"CONSENT_EXPIRED"});
});
