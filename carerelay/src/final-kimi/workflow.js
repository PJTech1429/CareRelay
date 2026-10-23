import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {WindowsJsonStore} from './atomic-file.js';
import {createServer} from '../server.js';
import {scoreUpdate,scoreContinuation,matchesAction} from '../bounded/scoring.js';
import {scoreEquivalent} from '../integration-recovery/evaluation.js';
import {validateInterpretation} from '../integration-recovery/validation.js';
const requireCheck=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};

export async function runFinalWorkflow({provider,plan,cases,directory,report,save=async()=>{},createStore=file=>new WindowsJsonStore(file)}){
 let server,base,sequence=0,current;const sessions={},views={},targets={};
 report.cases??=[];report.transcript??=[];report.confirmations??=[];
 async function start(){server=createServer({provider,conversationOptions:{validate:validateInterpretation},dynamicStore:createStore(path.join(directory,'state.json'))});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});base=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){if(server){await new Promise((r,j)=>server.close(e=>e?j(e):r()));server=null;}}
 async function rpc(session,method,params={}){
  const request={jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++sequence}),method,params};
  const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json','MCP-Protocol-Version':'2025-11-25',...(session?{'MCP-Session-Id':session}:{})},body:JSON.stringify(request),signal:AbortSignal.timeout(180000)});
  const result=response.status===202?{status:202}:await response.json();report.transcript.push({session,request,response:result});await save();
  if(!response.ok||result.error)throw Object.assign(new Error('MCP_REQUEST_REJECTED'),{code:'MCP_REQUEST_REJECTED',details:result.error});
  return {id:response.headers.get('mcp-session-id'),value:result.result};
 }
 async function call(s,name,args={}){return (await rpc(s,'tools/call',{name,arguments:{mode:'dynamic',...args}})).value.structuredContent;}
 async function open(caregiver){const s=(await rpc(null,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'care-relay-bounded-model-validation',version:'1'}})).id;await rpc(s,'notifications/initialized');await call(s,'record_caregiver_update',{operation:'open',caregiver});return s;}
 async function confirm(session,p,expectedOwner,expectedStatus='pending'){
  requireCheck(p&&!p.needsClarification,'UNRESOLVED_PROPOSAL');
  let blocked=false;try{await call(session,'confirm_task_assignment',{proposalId:p.id,version:p.version,consentId:'NO-CONSENT',confirmed:true});}catch{blocked=true;}
  requireCheck(blocked,'CONSENT_BYPASS');
  const preview=await call(session,'request_task_assignment_consent',{proposalId:p.id,version:p.version});
  requireCheck(preview.preview.payload.proposalId===p.id&&preview.preview.payload.owner===p.proposedOwner,'WRONG_CONSEQUENCE_PREVIEW');
  const view=await call(session,'confirm_task_assignment',{proposalId:p.id,version:p.version,consentId:preview.preview.consentId,confirmed:true});
  const task=view.confirmedTask;requireCheck(task?.owner===expectedOwner&&task?.status===expectedStatus&&task.consentId===preview.preview.consentId,'CONFIRMATION_STATE_FAILURE');
  report.confirmations.push({caseId:current.id,type:'EXPLICIT_AUTOMATED_TEST_CONFIRMATION',preview:preview.preview,task});await save();return task;
 }
 try{
  await start();
  // Exercise the same local HTTP/MCP path used by the simulator, never a direct store mock.
  for(const id of plan.sequence){
   current=cases.find(c=>c.id===id)??plan.continuations.find(c=>c.id===id);provider.caseId=id;
   if(id==='S4')requireCheck(report.cases.length===5&&report.cases.every(c=>c.passed),'STAGE_ONE_NOT_PROMISING');
   let session,target;
   if(current.parent){session=sessions[current.parent];target=id==='C1'?targets.chairs.id:targets.photos.id;}
   else session=sessions[id]=await open(current.speakerMetadata);
   const before=await call(session,'get_caregiver_handoff');
   const args={text:current.message,intent:current.intent??'update',...(id==='C1'?{proposalId:target}:id==='C2'?{targetId:target}:{})};
   const view=await call(session,'record_caregiver_update',args);views[id]=view;
   const proof=await call(session,'get_audit_trail'),raw=proof.messages.at(-1)?.raw;
   const evaluation=current.parent?null:scoreEquivalent(current,raw,proof.messages.at(-1).diagnostics);
   const result=current.parent?scoreContinuation(current,raw,target):{...evaluation.equivalentScore,evaluation};
   result.checks.noSilentTaskMutation=JSON.stringify(before.tasks)===JSON.stringify(view.tasks);
   result.checks.auditVerified=view.auditVerified===true;
   if(id==='S1'||id==='S3')result.checks.unresolved=view.proposals.length===current.expected.responsibilities.length&&view.proposals.every(p=>p.status==='Unresolved'&&p.needsClarification&&p.owner===null);
   if(id==='S2'||id==='S4')result.checks.awaitsExplicitConsent=view.proposals.filter(p=>p.kind==='responsibility').every(p=>p.status==='Awaiting Confirmation'&&!p.needsClarification&&p.owner===null);
   if(id==='C1'||id==='C2')result.checks.awaitingConfirmation=view.proposals.some(p=>p.proposedOwner===current.expected.ownerText&&p.status==='Awaiting Confirmation'&&p.owner===null);
   result.passed=Object.values(result.checks).every(Boolean);result.raw=raw;result.provenance=proof.messages.at(-1)?.diagnostics;report.cases.push(result);await save();
   requireCheck(result.passed,'FROZEN_SEMANTIC_GATE_FAILED');
   if(id==='S1'||id==='S3'){
    for(const p of view.proposals){let blocked=false;try{await call(session,'request_task_assignment_consent',{proposalId:p.id,version:p.version});}catch{blocked=true;}requireCheck(blocked,'UNRESOLVED_PREVIEW_ALLOWED');}
   }
   if(id==='S2'){
    targets.photos=await confirm(session,view.proposals.find(p=>matchesAction(p.action,'take framed photos to repair shop')),'Ravi');
    targets.lamp=await confirm(session,view.proposals.find(p=>matchesAction(p.action,'collect repaired lamp')),null,'reported_complete');
    // Restart after S2 BEFORE any more model calls. New MCP identities are real.
    await stop();await start();const next=await open('Inez');requireCheck(next!==session,'SESSION_NOT_NEW');
    const h=await call(next,'get_caregiver_handoff'),proof2=await call(next,'get_audit_trail');
    requireCheck(h.tasks.some(t=>t.id===targets.photos.id&&t.owner==='Ravi'&&t.status==='pending'&&t.title===targets.photos.title),'S2_PERSISTENT_HANDOFF_FAILED');
    requireCheck(h.tasks.some(t=>t.id===targets.lamp.id&&t.status==='reported_complete'&&t.owner===null),'S2_COMPLETION_REPORT_LOST');
    requireCheck(h.answer.text.includes('handoff for Inez')&&h.answer.citations.some(c=>c.recordId===targets.photos.id&&c.evidence.length>0),'S2_CITED_HANDOFF_FAILED');
    requireCheck(proof2.auditVerified&&proof2.consents.filter(c=>c.confirmedAt).length===2,'S2_CONSENT_AUDIT_FAILED');
    report.s2Handoff={succeeded:true,liveProposal:!provider.offline,serverRestart:true,newSession:true,noAdditionalInference:true,view:h,proof:proof2};await save();
    // Re-establish the original caregiver in a fresh transport session for C2.
    sessions.S2=await open('Ravi');
   }
   if(id==='S3')targets.chairs=view.proposals.find(p=>matchesAction(p.action,'bring folding chairs'));
   if(id==='C1'){
    targets.confirmedChairs=await confirm(session,view.proposals.find(p=>p.id===target),'Lena');
    const state=await call(session,'get_caregiver_handoff');requireCheck(state.proposals.some(p=>matchesAction(p.action,'sweep front step')&&p.needsClarification),'OTHER_RESPONSIBILITY_LOST');
   }
   if(id==='C2'){
    const p=view.proposals.find(p=>p.kind==='correction'&&p.targetId===target);targets.correctedPhotos=await confirm(session,p,'Jules');
    requireCheck(targets.correctedPhotos.history?.at(-1)?.owner==='Ravi'&&targets.correctedPhotos.evidence.length>=2,'CORRECTION_HISTORY_LOST');
   }
   if(id==='C2'){
    await stop();await start();const next=await open('Inez');requireCheck(next!==session,'SESSION_NOT_NEW');
    const handoff=await call(next,'get_caregiver_handoff'),proof=await call(next,'get_audit_trail');
    const task=targets.correctedPhotos;
    requireCheck(handoff.tasks.some(t=>t.id===task.id&&t.owner==='Jules'&&t.status==='pending'),'PERSISTENT_HANDOFF_FAILED');
    requireCheck(handoff.answer.text.includes('handoff for Inez')&&handoff.answer.citations.some(c=>c.recordId===task.id&&c.evidence.length>=2),'CITED_HANDOFF_FAILED');
    requireCheck(proof.auditVerified&&proof.consents.filter(c=>c.confirmedAt).length===4,'AUDIT_CONSENT_FAILURE');
    report.handoff={succeeded:true,serverRestart:true,newSession:true,liveProposal:!provider.offline,retrievalProvider:'verified application state (no additional inference)',view:handoff,proof};
    report.persistedState=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
   }
  }
  report.status=provider.offline?'OFFLINE_SYNTHETIC_WORKFLOW_PASS':'LIVE_CHECKS_PASSED_REQUIRES_SEMANTIC_REVIEW';report.passed=true;
 }catch(e){
  provider.stop(e.code??e.message);report.passed=false;report.status='STOP';report.failure={caseId:current?.id,code:e.code??e.message,details:e.details??null};
  if(current&&!report.cases.some(c=>c.caseId===current.id)){
   const attempt=provider.attempts.at(-1),raw=attempt?.interpretation;let semantic=null;
   try{if(raw)semantic=current.parent?scoreContinuation(current,raw,current.id==='C1'?targets.chairs?.id:targets.photos?.id):scoreUpdate(current,raw);}catch{}
   report.cases.push({...semantic,caseId:current.id,passed:false,validMessageRejected:attempt?.error?.code==='INVALID_PROPOSAL',classification:'CONTRACT_OR_INTEGRATION_REJECTION_REVIEW_REQUIRED',attempt:attempt??null});
  }
 }finally{await stop();report.notRun=plan.sequence.filter(id=>!report.cases.some(c=>c.caseId===id));await save();}
 return report;
}
