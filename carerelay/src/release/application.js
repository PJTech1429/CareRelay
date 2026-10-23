import {validateForReview} from './review-projection.js';
import {routeIntent} from '../ai/intent-router.js';
import {ReleaseController} from './controller.js';
export class ApplicationController extends ReleaseController{
 constructor(store,{gate,...options}){super(store,{...options,validate:(raw,context,intent)=>{const checked=validateForReview(raw,context,intent),scope=gate.scope.getStore();return {...checked,interpretationOrigin:scope?.mode==='recovery'?{source:'GENUINE_SAVED_RESPONSE_LOCAL_RECOVERY',newInference:false,attemptId:scope.capture.attemptId}:scope?.mode==='live'?{source:gate.send?'OFFLINE_INJECTED_TRANSPORT':'FRESH_KIMI_INFERENCE',newInference:!gate.send}:{source:scope?.mode==='demo'?'OFFLINE_GRAMMAR_SIMULATION_NOT_AI':scope?.mode==='replay'?'GENUINE_SAVED_RESPONSE_REPLAY':'VERIFIED_STATE_OR_OFFLINE',newInference:false}};},provider:gate,messageFactory:gate.messageFactory});this.gate=gate;}
 view(s,session,extra={}){const value=super.view(s,session,extra);for(const p of value.proposals){if(p.kind!=='review')continue;const source=s.messages.find(m=>m.original.id===p.messageId);const detail=source?.diagnostics?.reviewDetails?.find(d=>d.evidence.messageId===p.evidence[0]?.messageId&&d.evidence.start===p.evidence[0]?.start&&d.evidence.end===p.evidence[0]?.end);if(detail)p.unverifiedInterpretation=structuredClone(detail);}return value;}
 async turn(id,args){if(args.executionMode==='replay'){const v=await this.gate.scope.run({mode:'replay'},()=>super.turn(id,args));return {...v,interpretationSource:'GENUINE_SAVED_KIMI_RESPONSE_NOT_FRESH'};}return super.turn(id,args);}
 async dynamicTurn(id,args){
  const view=await this.snapshot(id);
  const pending=args.proposalId?view.proposals.find(p=>p.id===args.proposalId):null;
  if(args.proposalId&&!pending)throw new Error('Choose a current proposal from your own session. No AWS request was made.');
  if(args.targetId&&!view.tasks.some(t=>t.id===args.targetId))throw new Error('Choose an existing confirmed responsibility. No AWS request was made.');
  // A pending draft must not hijack an unrelated NEW update as clarification.
  // Explicit conversational reply targets select clarification; otherwise route
  // questions/corrections/new updates independently of previously unresolved work.
  const intent=routeIntent(args.text,{intent:args.intent??'auto',pending});
  const before=new Set(view.proposals.map(p=>p.id)),isReviewReply=pending?.kind==='review'&&intent==='clarification';const result=await super.turn(id,{...args,intent:isReviewReply?'update':intent});if(isReviewReply&&result.proposals.some(p=>!before.has(p.id)&&p.kind==='responsibility'&&!p.needsClarification)){const updated=await this.cancel(id,{proposalId:pending.id,version:pending.version});return {...updated,reply:'Your new AI-interpreted statement produced a replacement proposal. The earlier review remains in source history. Preview and explicitly confirm the new proposal; no assignment has been made.'};}return result;
 }
 async recoverAi(id,args){const binding=await this.transaction(s=>{const session=this.session(s,id),attempt=this.gate.state.attempts.find(a=>a.id===args.attemptId),ticket=attempt&&this.gate.state.tickets[attempt.ticketId],original=ticket&&s.sessions[ticket.sessionId];if(!original||original.caregiver!==session.caregiver)throw new Error('Only the original caregiver identity can review this saved response.');return {session:structuredClone(session),originalCaregiver:original.caregiver};});return this.gate.recover(id,{...args,originalCaregiver:binding.originalCaregiver},binding.session,fields=>super.turn(id,fields));}
 async prepareAi(id,args){const view=await this.snapshot(id);if(args.proposalId&&!view.proposals.some(p=>p.id===args.proposalId))throw new Error('Choose a current proposal from your own session. No AWS request was made.');if(args.targetId&&!view.tasks.some(t=>t.id===args.targetId))throw new Error('Choose an existing confirmed responsibility. No AWS request was made.');return this.gate.prepare(id,args);}
 async approveAi(id,args){await this.snapshot(id);const v=await this.gate.approve(id,args,fields=>this.dynamicTurn(id,fields));return {...v,interpretationSource:this.gate.send?'OFFLINE_TEST_STUB_NOT_LIVE':'FRESH_BEDROCK_KIMI_INFERENCE'};}
 async cancelAi(id,args){await this.snapshot(id);return this.gate.cancel(id,args);}
 async establishAllowance(id,args){await this.snapshot(id);return this.gate.establish(id,args);}
 async lockAllowance(id){await this.snapshot(id);return this.gate.lock();}
 async costStatus(id){await this.snapshot(id);return this.gate.summary();}
}
