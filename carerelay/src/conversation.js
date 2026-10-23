
import {randomUUID,createHash} from 'node:crypto';
import {taskTiming,clockSpans,proposalChanges} from './release/task-fields.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
import {assertNonMedical} from './domain.js';
import {ConsentLedger,AppendOnlyAuditLog} from '../packages/mcp-consent-audit/src/index.js';
import {OfflineMockProvider} from './ai/offline-provider.js';
import {routeIntent} from './ai/intent-router.js';
import {assertAccepted} from './ai/evidence.js';
import {projectUpdate} from './ai/proposal-adapter.js';
const initial=()=>({version:0,sessions:{},messages:[],proposals:[],tasks:[],facts:[],shifts:[],consents:[],audit:[]});
const fault=(code,message)=>Object.assign(new Error(message),{code});
const validName=name=>typeof name==='string'&&name.trim().length>0&&name.length<=80;
const clone=structuredClone;
export class ConversationController{
 constructor(store,{provider=new OfflineMockProvider(),validate=assertAccepted,project=projectUpdate,messageFactory=()=>({id:randomUUID(),at:new Date().toISOString()})}={}){this.store=store;this.provider=provider;this.validate=validate;this.project=project;this.messageFactory=messageFactory;this.queue=Promise.resolve();}
 // One local process owns this file. All reads/writes share this queue. A failed
 // provider or failed save never commits a partial mutation.
 transaction(fn){const run=this.queue.then(async()=>{const outer=await this.store.load(),s=outer.dynamic??initial();this.verifyIntegrity(s);const result=await fn(s);outer.dynamic=s;await this.store.save(outer);return result;});this.queue=run.catch(()=>{});return run;}
 verifyIntegrity(s){
  new AppendOnlyAuditLog({entries:s.audit});
  for(const entry of s.audit){
   if(entry.metadata.messageDigest){const message=s.messages.find(m=>m.original.id===entry.subject);if(!message||digest(message)!==entry.metadata.messageDigest)throw fault('SOURCE_INTEGRITY','Stored source integrity check failed.');}
  }
  for(const task of s.tasks){const latest=s.audit.filter(e=>e.action==='proposal_confirmed'&&e.subject===task.id).at(-1);if(latest?.metadata.taskDigest&&digest(task)!==latest.metadata.taskDigest)throw fault('STATE_INTEGRITY','Stored responsibility integrity check failed.');}
 }
 audit(s,action,session,subject,metadata={}){const log=new AppendOnlyAuditLog({entries:s.audit});log.append({action,actor:session.caregiver,subject,metadata,provenance:[]});s.audit=log.export();}
 async open(sessionId,caregiver){if(!validName(caregiver))throw fault('INVALID_CAREGIVER','Enter a caregiver name (1–80 characters).');return this.transaction(s=>{if(s.sessions[sessionId]&&s.sessions[sessionId].caregiver!==caregiver)throw fault('IDENTITY_BOUND','Start a new MCP session to switch caregiver.');s.sessions[sessionId]??={id:sessionId,caregiver:caregiver.trim(),pendingId:null,createdAt:new Date().toISOString()};return this.view(s,s.sessions[sessionId]);});}
 session(s,id){const session=s.sessions[id];if(!session)throw fault('SESSION_REQUIRED','Start a caregiver session first.');return session;}
 view(s,session,extra={}){return {provider:this.provider.health(),session:clone(session),version:s.version,proposals:clone(s.proposals.filter(p=>p.sessionId===session.id&& !['Confirmed','Cancelled'].includes(p.status))),unresolvedCount:s.proposals.filter(p=>!['Confirmed','Cancelled'].includes(p.status)).length,tasks:clone(s.tasks),facts:clone(s.facts),shifts:clone(s.shifts),auditVerified:new AppendOnlyAuditLog({entries:s.audit}).verify(),...extra};}
 async snapshot(id){return this.transaction(s=>this.view(s,this.session(s,id)));}
 async turn(id,{text,intent='auto',proposalId=null,targetId=null}){
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw fault('INVALID_INPUT','Enter 1–4,000 characters.');
  assertNonMedical(text);
  if(/\b(ignore|override|disregard)\b.{0,70}\b(instructions|rules|system|consent)\b|\b(?:forge|fabricate)\b.{0,30}\b(consent|confirmation)\b/i.test(text))throw fault('INSTRUCTION_BOUNDARY','Instructions to bypass controls are not caregiver updates.');
  return this.transaction(async s=>{
   const session=this.session(s,id);
   const pending=s.proposals.find(p=>p.id===(proposalId??session.pendingId)&&p.sessionId===id&&!['Confirmed','Cancelled'].includes(p.status));
   const routed=routeIntent(text,{intent,pending});
   if(routed==='clarification'&&!pending)throw fault('NO_PENDING','Choose a pending proposal before clarifying.');
   const sourceEnvelope=this.messageFactory(text,session);
   const message={id:sourceEnvelope.id,text,at:sourceEnvelope.at};
   if(typeof message.id!=='string'||!message.id||s.messages.some(m=>m.original.id===message.id))throw fault('MESSAGE_ID_COLLISION','This source message has already been recorded.');
   const context={currentMessageId:message.id,originalMessages:[...s.messages.filter(m=>m.sessionId===id).slice(-8).map(m=>m.original),message],verifiedRecords:clone(s.tasks),pending:pending?{id:pending.id,action:pending.action,kind:pending.kind}:null,selectedTaskId:targetId};
   context.speakersByMessage=Object.fromEntries([...s.messages.filter(m=>m.sessionId===id).map(m=>[m.original.id,{caregiver:m.callerMetadata.caregiver,sessionId:id,source:'caller_metadata_not_quotation'}]),[message.id,{caregiver:session.caregiver,sessionId:id,source:'caller_metadata_not_quotation'}]]);
   const raw=await this.provider.interpret(context,routed);
   const diagnostics=this.validate(raw,context,routed);
   if(raw.boundary!=='coordination')return this.view(s,session,{reply:'CareRelay supports non-medical household coordination only. No action was taken.',boundary:raw.boundary});
   s.messages.push({original:message,sessionId:id,callerMetadata:{caregiver:session.caregiver,source:'caller_supplied_not_message_evidence'},raw:clone(raw),diagnostics,provider:this.provider.provider});
   let reply;
   if(routed==='update'){
    const projected=this.project(raw,message,session,diagnostics);s.proposals.push(...projected.proposals);s.facts.push(...projected.facts);s.shifts.push(...projected.shifts);
    session.pendingId=projected.proposals.find(p=>p.needsClarification)?.id??null;
    reply=projected.proposals.length?`${projected.proposals.length} proposal(s) prepared. ${session.pendingId?'Please review the unresolved action or owner.':'Review the consequence preview before confirming.'} Nothing has been assigned.`:'Your source reports and stated shifts were recorded. No responsibility was assigned.';
   }else if(routed==='clarification'){
    if(raw.decision==='resolve'&&raw.ownerText){
     if(pending.kind==='review')throw fault('ACTION_REVIEW_REQUIRED','Restate this unfamiliar report as a new update with a clear action. The original report remains in review.');
     pending.proposedOwner=/^(I|my)$/i.test(raw.ownerText)?session.caregiver:raw.ownerText;
     pending.evidence.push(raw.evidence);pending.needsClarification=false;pending.status='Awaiting Confirmation';pending.version++;session.pendingId=null;
     reply=`Proposed owner: ${pending.proposedOwner}. Please preview and explicitly confirm. No assignment yet.`;
    }else reply='Ownership is still uncertain. Choose the proposal and name one accountable caregiver; nothing was assigned.';
   }else if(routed==='correction'){
    // A UI-selected target is authoritative; otherwise the model must return one
    // unambiguous existing ID. "that" with several records always asks first.
    const ambiguousReference=/\b(?:that|it|this)\b/i.test(text)&&s.tasks.length>1&&!targetId&&!/\btask\s+\d+\b/i.test(text);
    const target=targetId?s.tasks.find(t=>t.id===targetId):!ambiguousReference&&raw.targetIds.length===1?s.tasks.find(t=>t.id===raw.targetIds[0]):null;
    if(targetId&&!target)throw fault('UNKNOWN_TARGET','The chosen task no longer exists.');
    const p={id:randomUUID(),version:1,sessionId:id,kind:'correction',action:raw.actionText??target?.title??text,operation:raw.operation,targetId:target?.id??null,targetVersion:target?.version??null,evidence:[raw.evidence],proposedOwner:/^(I|my)$/i.test(raw.ownerText??'')?session.caregiver:raw.ownerText,owner:null,status:'Unresolved',needsClarification:!target||raw.operation==='uncertain'||(raw.operation==='replace_owner'&&!raw.ownerText),createdAt:message.at,reportedBy:session.caregiver};
    p.changes={title:raw.actionText,owner:p.proposedOwner,timeText:raw.timeText??null};
    const changedClocks=clockSpans(raw.actionText).filter(x=>!clockSpans(target?.title).includes(x));
    if(changedClocks.length&&(!raw.timeText||changedClocks.some(x=>!clockSpans(raw.timeText).includes(x)))){p.needsClarification=true;p.correctionWarning='Timing changed in wording without a supported structured time. Review all corrected fields before confirmation.';}
    if(!p.needsClarification)p.status='Awaiting Confirmation';
    if(target&&pending?.kind==='correction'&&pending.targetId===null){pending.status='Cancelled';pending.version++;this.audit(s,'ambiguous_correction_superseded',session,pending.id,{replacement:p.id});}
    s.proposals.push(p);session.pendingId=p.needsClarification?p.id:null;
    reply=!target?'Which responsibility should change? Select its task number and send the correction again. No record changed.':'Correction proposed. The existing record stays unchanged until you preview and confirm.';
   }else{
    const answer=this.answer(s,session,raw.scope);this.audit(s,'verified_handoff_read',session,id,{recordIds:answer.recordIds});return this.view(s,session,{reply:answer.text,answer,intent:routed});
   }
   s.version++;this.audit(s,'interpretation_proposed',session,message.id,{intent:routed,provider:this.provider.provider,messageDigest:digest(s.messages.at(-1))});
   return this.view(s,session,{reply,intent:routed});
  });
 }
 answer(s,session,scope='all'){
  const tasks=s.tasks.filter(t=>scope==='shifts'?false:scope==='mine'?t.owner===session.caregiver:scope==='open'?t.status==='pending':scope==='completed'?t.status==='reported_complete':true);
  const drafts=s.proposals.filter(p=>!['Confirmed','Cancelled'].includes(p.status));
  const lines=tasks.map(t=>`${t.title} — ${t.status==='reported_complete'?'completion reported, not independently verified':t.status}; ${t.owner??'no confirmed owner'}. Confirmed by ${t.confirmedBy}.`);
  const facts=scope==='all'?s.facts.slice(-8):[];const shifts=['all','shifts'].includes(scope)?s.shifts:[];
  if(scope==='unknown')return {text:'I cannot resolve that specific question with the available interpretation scope. The confirmed household records remain visible below. Ask “What changed?”, “What are my tasks?”, “What is open?” or “What are the shifts?”.',recordIds:[],citations:[],scope};
  const citations=[...tasks.map(t=>({recordId:t.id,evidence:t.evidence,confirmedBy:t.confirmedBy})),...facts.map(f=>({recordId:f.id,evidence:[f.evidence],reportedBy:f.reportedBy})),...shifts.map(x=>({recordId:x.id,evidence:[x.evidence],reportedBy:x.reportedBy}))];
  return {scope,text:[`Verified application handoff for ${session.caregiver}.`,...lines,...(['all','open'].includes(scope)?drafts.map(p=>`UNCONFIRMED: ${p.action} — reported by ${p.reportedBy}; ownership is not assigned.`):[]),...facts.map(f=>`Reported by ${f.reportedBy}: ${f.statement}`),...shifts.map(x=>`Reported shift: ${x.caregiver}, start ${x.startsAt??'not stated'}, end ${x.endsAt??'not stated'}.`),`${s.proposals.filter(p=>!['Confirmed','Cancelled'].includes(p.status)).length} unconfirmed proposal(s) remain.`,!tasks.length?'No confirmed responsibility matches this request.':''].filter(Boolean).join('\n'),recordIds:citations.map(c=>c.recordId),citations};
 }
 payload(p,session){return {proposalId:p.id,proposalVersion:p.version,sessionId:session.id,actor:session.caregiver,kind:p.kind,action:p.action,owner:p.proposedOwner??null,operation:p.operation??p.confirmationEffect,targetId:p.targetId??null,targetVersion:p.targetVersion??null};}
 async preview(id,{proposalId,version}){return this.transaction(s=>{
  const session=this.session(s,id),p=s.proposals.find(x=>x.id===proposalId&&x.sessionId===id);
  if(!p||p.version!==version||['Confirmed','Cancelled'].includes(p.status))throw fault('STALE_PROPOSAL','This proposal changed. Refresh and review it again.');
  if(p.needsClarification||p.kind==='review')throw fault('CLARIFICATION_REQUIRED','Resolve the action, target and owner before previewing.');
  if(p.kind==='correction'&&s.tasks.find(t=>t.id===p.targetId)?.version!==p.targetVersion)throw fault('STALE_TARGET','The responsibility changed; create a new correction.');
  if(p.kind==='correction'&&['revise','replace_owner'].includes(p.operation)){const target=s.tasks.find(t=>t.id===p.targetId),changes=proposalChanges(p),candidate={...target,title:changes.title??target.title,timeText:changes.timeText??taskTiming(s,target).timeText,timingNeedsReview:changes.timeText!=null?false:target.timingNeedsReview};if(taskTiming(s,candidate).timingNeedsReview)throw fault('INCONSISTENT_CORRECTION','Correct both the action wording and structured timing before confirming.');}
  const payload=this.payload(p,session),ledger=new ConsentLedger({records:s.consents});
  const consent=ledger.request({action:'confirm_care_proposal',actor:session.caregiver,subject:p.id,payload});s.consents.push(consent);
  this.audit(s,'proposal_consent_requested',session,p.id,{consentId:consent.consentId,payload});
  return this.view(s,session,{preview:{...consent,payload,text:p.kind==='correction'?`Change task ${p.targetId}: ${p.operation}. Proposed owner: ${p.proposedOwner??'unchanged'}. Original history is retained.`:p.confirmationEffect==='record_completion_report'?`Record “${p.action}” as a caregiver-reported completion. This does not independently verify physical completion.`:`Assign “${p.action}” to ${p.proposedOwner}. No message will be sent to them.`,proposalId:p.id,version:p.version}});
 });}
 async confirm(id,{proposalId,version,consentId,confirmed}){return this.transaction(s=>{
  const session=this.session(s,id),p=s.proposals.find(x=>x.id===proposalId&&x.sessionId===id);
  if(!p||p.version!==version||['Confirmed','Cancelled'].includes(p.status))throw fault('STALE_PROPOSAL','Proposal changed or is already resolved.');
  if(p.needsClarification||p.kind==='review')throw fault('CLARIFICATION_REQUIRED','Review is required.');
  const ledger=new ConsentLedger({records:s.consents}),record=ledger.confirm({consentId,actor:session.caregiver,payload:this.payload(p,session),confirmed});
  let task;
  if(p.kind==='correction'){
   task=s.tasks.find(t=>t.id===p.targetId);if(!task||task.version!==p.targetVersion)throw fault('STALE_TARGET','The task changed after preview. Nothing was applied.');
   const timing=taskTiming(s,task);
   task.history??=[];task.history.push(clone({...task,timeText:timing.timeText,timingNeedsReview:timing.timingNeedsReview,history:undefined}));
   task.timeText=timing.timeText;if(timing.timingNeedsReview)task.timingNeedsReview=true;
   if(p.operation==='cancel')task.status='cancelled';
   else if(p.operation==='replace_owner'||p.operation==='revise'){
    const changes=proposalChanges(p);
    if(changes.title!=null)task.title=changes.title;
    if(changes.owner!=null)task.owner=changes.owner;
    if(changes.timeText!=null){task.timeText=changes.timeText;delete task.timingNeedsReview;}
   }
   else if(p.operation==='complete')task.status='reported_complete';
   else throw fault('UNKNOWN_CHANGE','Clarify the change first.');
   task.evidence.push(...p.evidence);task.version++;
  }else{
   task={id:randomUUID(),title:p.action,owner:p.confirmationEffect==='record_completion_report'?null:p.proposedOwner,status:p.confirmationEffect==='record_completion_report'?'reported_complete':'pending',version:1,evidence:clone(p.evidence),proposalId:p.id,reportedBy:p.reportedBy,timeText:p.timeText??p.interpretation?.timeText??null};s.tasks.push(task);
  }
  task.confirmedBy=session.caregiver;task.confirmedAt=new Date().toISOString();task.consentId=consentId;
  Object.assign(s.consents.find(c=>c.consentId===consentId),record);p.status='Confirmed';p.version++;session.pendingId=null;s.version++;
  this.audit(s,'proposal_confirmed',session,task.id,{consentId,proposalId:p.id,taskVersion:task.version,taskDigest:digest(task)});
  return this.view(s,session,{reply:'Confirmed and saved locally. The next caregiver session will read this record.',confirmedTask:clone(task)});
 });}
 async cancel(id,{proposalId,version}){return this.transaction(s=>{const session=this.session(s,id),p=s.proposals.find(p=>p.id===proposalId&&p.sessionId===id);if(!p||p.version!==version||p.status==='Confirmed')throw fault('STALE_PROPOSAL','Cannot cancel this proposal.');p.status='Cancelled';p.version++;if(session.pendingId===p.id)session.pendingId=null;this.audit(s,'proposal_dismissed',session,p.id);return this.view(s,session,{reply:'Draft dismissed. Confirmed records were not changed.'});});}
 async handoff(id){return this.transaction(s=>{const session=this.session(s,id),answer=this.answer(s,session);this.audit(s,'verified_handoff_read',session,id,{recordIds:answer.recordIds});return this.view(s,session,{reply:answer.text,answer});});}
 async proof(id){return this.transaction(s=>{this.session(s,id);return {audit:clone(s.audit),messages:clone(s.messages),consents:clone(s.consents),auditVerified:new AppendOnlyAuditLog({entries:s.audit}).verify()};});}
}
