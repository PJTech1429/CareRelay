import {buildChatRequest,measureChatUsage} from '../chat-recovery/adapter.js';
import {acceptModelResponse} from '../integration-recovery/provider.js';
export const SEQUENCE=['S2','S3','C1','C2'];
export const RESERVE=.0594;
export function verifyPlan(plan){
 if(plan.profile!=='care-relay'||plan.region!=='us-east-1'||plan.model.modelId!=='us.moonshotai.kimi-k3'||plan.maxOutputTokens!==1600||plan.maxInputTokens!==8000||plan.maxRequestBytes!==6500||plan.previousDispatchAttempts!==2||plan.maxNewCalls!==4||plan.maxTotalAttempts!==6||plan.maximumAdditionalReservationUsd!==.2376||plan.maximumCumulativeReservationUsd!==.3564||plan.planningAllInInrPerUsd!==135||plan.personalExposureAuthorizedInr!==50||plan.model.input!==3.3||plan.model.output!==16.5||plan.model.cacheWrite!==4.125||plan.model.cacheRead!==.33||JSON.stringify(plan.sequence)!==JSON.stringify(SEQUENCE))throw new Error('UNAPPROVED_FINAL_PLAN');
 if(RESERVE*4>.2376+1e-12||.3564*135>50)throw new Error('FINANCIAL_LIMIT');
}
export class FinalProvider{
 constructor({plan,cases,send,reserve,saveEvidence,offline=false,verifyFreeze=async()=>{}}){verifyPlan(plan);Object.assign(this,{plan,cases,send,reserve,saveEvidence,offline,verifyFreeze});this.calls=0;this.attempts=[];this.estimatedUsd=0;this.stopped=false;this.busy=false;this.provider=offline?'OFFLINE_SYNTHETIC_RUNNER_FIXTURES':'amazon-bedrock-kimi-live';}
 health(){return {provider:this.provider,ready:!this.stopped,liveInference:!this.offline,label:this.offline?'OFFLINE synthetic runner test':'Bounded live Kimi validation',calls:this.calls,maxCalls:4};}
 stop(reason){this.stopped=true;this.stopReason=reason;}
 async interpret(context,intent){
  if(this.stopped||this.busy||this.calls>=4)throw new Error('INFERENCE_BUDGET_STOP');
  const c=this.cases.find(c=>c.id===SEQUENCE[this.calls]);
  if(!c||this.caseId!==c.id||context.originalMessages.at(-1)?.text!==c.message||(c.intent??'update')!==intent||context.speakersByMessage?.[context.currentMessageId]?.caregiver!==c.speakerMetadata)throw new Error('FROZEN_CASE_MISMATCH');
  const request=buildChatRequest(context,intent,this.plan),bytes=Buffer.byteLength(JSON.stringify(request));
  if(bytes>6500)throw new Error('REQUEST_BYTE_LIMIT');
  await this.verifyFreeze();this.busy=true;
  const e={caseId:c.id,cumulativeAttempt:this.calls+3,source:this.provider,request,requestBytes:bytes,status:'RESERVING',reservedUsd:RESERVE,startedAtUTC:new Date().toISOString()};
  try{
   // Durable machine-wide reservation MUST succeed before any network send.
   await this.reserve({caseId:c.id,cumulativeAttempt:e.cumulativeAttempt,request,reservedUsd:RESERVE});
   this.calls++;this.attempts.push(e);e.status='RESERVED';await this.saveEvidence(e);
   const start=performance.now();const result=await this.send(request);e.latencyMs=performance.now()-start;e.raw=result.raw;e.service=result.service;e.status='RECEIVED';await this.saveEvidence(e);
   e.usage=measureChatUsage(e.raw,this.plan);this.estimatedUsd+=e.usage.conservativeEstimatedUsd;
   if(this.estimatedUsd>.2376+1e-12||e.usage.conservativeEstimatedUsd>RESERVE+1e-12)throw new Error('COST_LIMIT_VIOLATION');
   if(e.raw.model!==this.plan.model.modelId||e.raw.service_tier&&e.raw.service_tier!=='default')throw new Error('UNEXPECTED_MODEL_OR_SERVICE_TIER');
   const accepted=acceptModelResponse(e.raw,context,intent);e.interpretation=accepted.interpretation;e.validation=accepted.diagnostics;e.envelope=accepted.envelope;e.status='VALIDATED_UNCONFIRMED_PROPOSAL';await this.saveEvidence(e);return e.interpretation;
  }catch(error){this.stop(error.code??error.message);e.status='STOPPED';e.error={code:error.code??error.message,diagnostics:error.diagnostics??null,service:error.service??null};await this.saveEvidence(e);throw error;}
  finally{this.busy=false;}
 }
}
