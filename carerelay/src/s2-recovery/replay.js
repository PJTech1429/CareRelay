import {readFile,mkdir} from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createServer} from '../server.js';import {WindowsJsonStore,writeJson} from '../final-kimi/atomic-file.js';
import {SavedS2Provider} from './provider.js';import {validateWithProjection,projectSemanticUpdate} from './semantics.js';
import {decodeEnvelope} from '../integration-recovery/envelope.js';import {scoreEquivalent} from '../integration-recovery/evaluation.js';
import {scoreUpdate} from '../bounded/scoring.js';
export async function replayS2({root,directory}){
 await mkdir(directory,{recursive:true});const baseDir=path.join(root,'evidence/s2-recovery/captured-review/original');
 const capture=JSON.parse(await readFile(path.join(baseDir,'attempt-3.json'))),cases=JSON.parse(await readFile(path.join(baseDir,'frozen-expectations.json'))),frozen=cases.find(c=>c.id==='S2');
 const provider=new SavedS2Provider(capture,frozen.speakerMetadata),original=provider.original,decoded=decodeEnvelope(capture.raw).value;
 const report={kind:'GENUINE_SAVED_S2_OFFLINE_REPLAY',newAwsCalls:0,newCostUsd:0,checks:[],transcript:[],confirmations:[],originalHistoricalResult:'FAIL_PRESERVED',modelAccuracyClaim:false};
 const check=(name,condition)=>{assert.ok(condition,name);report.checks.push({name,passed:true});};let server,base,id=0;
 async function start(){server=createServer({provider,dynamicStore:new WindowsJsonStore(path.join(directory,'state.json')),conversationOptions:{validate:validateWithProjection,project:projectSemanticUpdate,messageFactory:provider.messageFactory}});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});base=`http://127.0.0.1:${server.address().port}`;}
 async function close(){if(server){await new Promise((r,j)=>server.close(e=>e?j(e):r()));server=null;}}
 async function rpc(session,method,params={}){const request={jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++id}),method,params};const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json','MCP-Protocol-Version':'2025-11-25',...(session?{'MCP-Session-Id':session}:{})},body:JSON.stringify(request)});const body=response.status===202?{}:await response.json();report.transcript.push({session,request,response:body});if(body.error||!response.ok)throw new Error(body.error?.message??'HTTP_ERROR');return {session:response.headers.get('mcp-session-id'),result:body.result};}
 const call=async(s,name,args={})=>(await rpc(s,'tools/call',{name,arguments:{mode:'dynamic',...args}})).result.structuredContent;
 async function open(caregiver){const s=(await rpc(null,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'genuine-s2-offline-replay',version:'1'}})).session;await rpc(s,'notifications/initialized');await call(s,'record_caregiver_update',{operation:'open',caregiver});return s;}
 try{
  await start();const session=await open(frozen.speakerMetadata),view=await call(session,'record_caregiver_update',{intent:'update',text:original.text});
  check('exactly two supported unconfirmed proposals; no task created',view.proposals.length===2&&view.tasks.length===0&&view.proposals.every(p=>p.owner===null&&p.status==='Awaiting Confirmation'));
  check('one unchanged Jules shift with literal 6 PM–9 PM evidence',view.shifts.length===1&&view.shifts[0].caregiver==='Jules'&&view.shifts[0].startsAt==='6 PM'&&view.shifts[0].endsAt==='9 PM'&&view.shifts[0].evidence.quote===decoded.shifts[0].evidence.quote);
  const proof=await call(session,'get_audit_trail'),stored=proof.messages[0];
  check('persisted original model interpretation is unchanged including third raw row',JSON.stringify(stored.raw)===JSON.stringify(decoded)&&stored.raw.responsibilities.length===3);
  check('source ID text timestamp and caller separation retained',JSON.stringify(stored.original)===JSON.stringify(original)&&stored.callerMetadata.caregiver==='Ravi');
  check('duplicate shift disposition is explicit and audit-bound',stored.diagnostics.projection.dispositions.length===1&&stored.diagnostics.projection.dispositions[0].kind==='shift_not_separate_task'&&stored.diagnostics.projection.rawMutated===false&&proof.auditVerified);
  const evaluated=scoreEquivalent(frozen,stored.diagnostics.applicationInterpretation,stored.diagnostics);
  report.evaluation={unchangedRawHistoricalScore:scoreUpdate(frozen,decoded),applicationProjection:evaluated};
  check('raw historical score remains failed; application projection passes unchanged expectations',!report.evaluation.unchangedRawHistoricalScore.passed&&evaluated.passed);
  const tasks=[];
  for(const p of view.proposals){
   let blocked=false;try{await call(session,'confirm_task_assignment',{proposalId:p.id,version:p.version,consentId:'NO-CONSENT',confirmed:true});}catch{blocked=true;}
   check('invalid consent blocked for '+p.action,blocked);
   const preview=(await call(session,'request_task_assignment_consent',{proposalId:p.id,version:p.version})).preview;
   check('preview preserves exact supported action '+p.action,preview.payload.action===p.action);
   const confirmation=await call(session,'confirm_task_assignment',{proposalId:p.id,version:p.version,consentId:preview.consentId,confirmed:true});tasks.push(confirmation.confirmedTask);report.confirmations.push({source:'EXPLICIT_AUTOMATED_TEST_CONFIRMATION',preview,task:confirmation.confirmedTask});
  }
  check('future photo delivery stays pending and binds caller Ravi',tasks.some(t=>t.owner==='Ravi'&&t.status==='pending'&&t.title===decoded.responsibilities[0].action));
  check('completed lamp remains reported completion, not new assigned work',tasks.some(t=>t.owner===null&&t.status==='reported_complete'&&t.title===decoded.responsibilities[1].action));
  await close();await start();const next=await open('Inez'),handoff=await call(next,'record_caregiver_update',{intent:'question',text:'What changed?'}),audit=await call(next,'get_audit_trail');
  check('restart and genuinely new session retrieve exactly two persisted responsibilities',next!==session&&handoff.tasks.length===2&&tasks.every(t=>handoff.tasks.some(x=>x.id===t.id&&x.title===t.title&&x.status===t.status&&x.owner===t.owner)));
  check('handoff retains one shift and never adds covering as a task',handoff.shifts.length===1&&handoff.tasks.every(t=>!t.title.includes('covering')));
  check('personalized handoff cites both exact task sources and shift',handoff.answer.text.includes('handoff for Inez')&&handoff.answer.citations.length===3&&tasks.every(t=>handoff.answer.citations.some(c=>c.recordId===t.id&&JSON.stringify(c.evidence)===JSON.stringify(t.evidence))));
  check('audit and two explicit consent records verify',audit.auditVerified&&audit.consents.filter(c=>c.confirmedAt).length===2);
  check('original saved response remains byte-equivalent in audit proof',JSON.stringify(audit.messages[0].raw)===JSON.stringify(decoded));
  report.handoff=handoff;report.audit=audit;report.providerEvents=provider.events;report.passed=true;report.status='PASS_OFFLINE_REPLAY_ONLY';
 }catch(e){report.passed=false;report.status='FAIL';report.error=e.message;throw e;}
 finally{await close();await writeJson(path.join(directory,'replay-report.json'),report);}
 return report;
}
