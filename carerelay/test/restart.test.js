import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../src/store.js";
import { CareRelayService } from "../src/service.js";

test("consent and audit survive a service restart",async()=>{
  const store=new JsonStore(path.join(await mkdtemp(path.join(os.tmpdir(),"care-restart-")),"state.json"));
  const first=new CareRelayService(store);const update=await first.recordUpdate({caregiver:"Priya",text:"The grocery delivery hasn't arrived"});const consent=await first.requestAssignmentConsent({taskId:update.tasks[0].id,owner:"Meera",requestedBy:"Priya"});
  const restarted=new CareRelayService(store);await restarted.confirmAssignment({consentId:consent.consentId,taskId:update.tasks[0].id,owner:"Meera",confirmedBy:"Priya",confirmed:true});const handoff=await restarted.getHandoff({nextCaregiver:"Meera"});assert.equal(handoff.pendingTasks[0].owner,"Meera");
  const audit=await restarted.getAudit();assert.equal(audit.entries.length,4);assert.equal(audit.entries[3].previousHash,audit.entries[2].hash);
});
