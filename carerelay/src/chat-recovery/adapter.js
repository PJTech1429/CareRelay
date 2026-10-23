import {SYSTEM} from '../ai/bedrock-provider.js';
import {contracts} from '../ai/intent-router.js';
import {evidenceIndex} from '../ai/evidence-index.js';
import {assertAccepted} from '../ai/evidence.js';

export const ENDPOINT='https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions';
export const KIMI_MODEL='us.moonshotai.kimi-k3';
// This wire builder is also the OFFLINE fallback adapter. Only Kimi is enabled
// by RecoveryProvider. A gpt-oss execution needs a separately authorized plan.
export function buildChatRequest(context,intent,plan,modelId=KIMI_MODEL){
 if(![KIMI_MODEL,'openai.gpt-oss-120b-1:0'].includes(modelId)||!Object.hasOwn(contracts,intent))throw new Error('UNAPPROVED_WIRE_MODEL_OR_INTENT');
 const payload={currentMessageId:context.currentMessageId,originalMessages:context.originalMessages,
  evidenceIndex:evidenceIndex(context.originalMessages),
  verifiedRecords:context.verifiedRecords.map(({id,title,owner,status,version,timeText})=>({id,title,owner,status,version,...(context.includeTaskTiming?{timeText:timeText??null}:{})})),
  pending:context.pending,selectedTaskId:context.selectedTaskId??null};
 return {model:modelId,messages:[{role:'system',content:SYSTEM+(intent==='correction'?' For corrections, populate ownerText and timeText for every explicitly requested owner/schedule change regardless of operation. Use null when unchanged. actionText is the complete revised action wording, not a substitute for the structured owner/time fields. Use revise for combined changes. Evidence must support every changed field.':'')},{role:'user',content:JSON.stringify(payload)}],
  max_tokens:plan.maxOutputTokens,
  tools:[{type:'function',function:{name:'interpret_care',description:'Return an unconfirmed interpretation; performs no actions.',parameters:structuredClone(contracts[intent])}}],
  tool_choice:'auto'};
}
export function parseChatResponse(raw){
 const choice=raw?.choices?.[0],message=choice?.message,uses=message?.tool_calls;
 if(!Array.isArray(raw?.choices)||raw.choices.length!==1||choice.finish_reason!=='tool_calls'||message.role!=='assistant'||!Array.isArray(uses)||uses.length!==1||uses[0].type!=='function'||uses[0].function?.name!=='interpret_care'||typeof uses[0].function.arguments!=='string')throw new Error('EXPECTED_SINGLE_INTERPRETATION_TOOL');
 let value;try{value=JSON.parse(uses[0].function.arguments);}catch{throw new Error('MALFORMED_TOOL_ARGUMENTS');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('MALFORMED_TOOL_ARGUMENTS');
 return value;
}
export function measureChatUsage(raw,plan){
 const u=raw?.usage;
 if(!u||!['prompt_tokens','completion_tokens','total_tokens'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0)||u.total_tokens!==u.prompt_tokens+u.completion_tokens)throw new Error('UNKNOWN_TOKEN_USAGE');
 if(u.prompt_tokens>plan.maxInputTokens||u.completion_tokens>plan.maxOutputTokens)throw new Error('TOKEN_LIMIT_VIOLATION');
 // Do not guess Kimi cache-hit accounting. Charge ALL prompt tokens at the
 // highest documented input/cache rate. Reasoning tokens are included in
 // completion_tokens, not added a second time. Preserve the complete raw usage.
 const rate=Math.max(plan.model.input,plan.model.cacheWrite,plan.model.cacheRead);
 return {promptTokens:u.prompt_tokens,completionTokens:u.completion_tokens,totalTokens:u.total_tokens,raw:structuredClone(u),
  conservativeEstimatedUsd:(u.prompt_tokens*rate+u.completion_tokens*plan.model.output)/1e6,
  method:'All prompt tokens at maximum documented input/cache rate; all completion tokens at output rate. Not an invoice.'};
}
export function validatePlan(plan){
 if(plan.endpoint!==ENDPOINT||plan.model?.modelId!==KIMI_MODEL||plan.profile!=='care-relay'||plan.region!=='us-east-1'||
 plan.previousDispatchAttempts!==1||plan.maxNewCalls!==5||plan.maxTotalAttempts!==6||plan.maxOutputTokens!==1600||plan.maxInputTokens!==8000||plan.maxRequestBytes!==6500||
 plan.previousUnmeteredReservationUsd!==.0594||plan.ceilingUsd!==.36||plan.personalExposureAuthorizedInr!==50||plan.planningAllInInrPerUsd!==135||
 plan.model.input!==3.3||plan.model.output!==16.5||plan.model.cacheWrite!==4.125||plan.model.cacheRead!==.33||
 JSON.stringify(plan.sequence)!==JSON.stringify(['S1','S2','S3','C1','C2']))throw new Error('UNAPPROVED_RECOVERY_PLAN');
 const reserve=(plan.maxInputTokens*Math.max(plan.model.input,plan.model.cacheWrite,plan.model.cacheRead)+plan.maxOutputTokens*plan.model.output)/1e6;
 if(plan.previousUnmeteredReservationUsd+reserve*plan.maxNewCalls>plan.ceilingUsd||plan.ceilingUsd*plan.planningAllInInrPerUsd>50)throw new Error('EXPOSURE_LIMIT');
 return reserve;
}
export class RecoveryProvider{
 constructor({plan,send,saveEvidence,offline=false}){
  this.reservePerCall=validatePlan(plan);Object.assign(this,{plan,send,saveEvidence,offline});
  this.calls=0;this.estimatedUsd=0;this.reservedUsd=plan.previousUnmeteredReservationUsd;this.stopped=false;this.busy=false;this.attempts=[];
  this.provider=offline?'offline-synthetic-chat-fixture':'amazon-bedrock';
 }
 health(){return {provider:this.provider,liveInference:!this.offline,ready:!this.stopped&&this.calls<this.plan.maxNewCalls,modelId:KIMI_MODEL,calls:this.calls,previousAttempts:1,maxCalls:5,estimatedUsd:this.estimatedUsd,label:this.offline?'OFFLINE authored Chat fixture — not model accuracy':'Authorized Kimi Chat Completions validation'};}
 stop(reason){this.stopped=true;this.stopReason=reason;}
 async interpret(context,intent){
  if(this.stopped||this.busy||this.calls>=this.plan.maxNewCalls||this.reservedUsd+this.reservePerCall>this.plan.ceilingUsd+1e-12)throw new Error('INFERENCE_BUDGET_STOP');
  if(this.caseId!==this.plan.sequence[this.calls])throw new Error('FROZEN_SEQUENCE_VIOLATION');
  const request=buildChatRequest(context,intent,this.plan),requestBytes=Buffer.byteLength(JSON.stringify(request));
  if(requestBytes>this.plan.maxRequestBytes)throw new Error('REQUEST_BYTE_LIMIT');
  this.busy=true;this.calls++;this.reservedUsd+=this.reservePerCall;
  const e={attempt:this.calls+1,newAttempt:this.calls,caseId:this.caseId,provider:this.provider,request,requestBytes,status:'RESERVED',startedAtUTC:new Date().toISOString(),reservedUsd:this.reservePerCall};this.attempts.push(e);
  const start=performance.now();
  try{
   await this.saveEvidence(e); // Durable reservation precedes dispatch; never refunded.
   const result=await this.send(request);e.raw=result.raw;e.service=result.service;e.latencyMs=performance.now()-start;e.status='RECEIVED';await this.saveEvidence(e);
   e.usage=measureChatUsage(e.raw,this.plan);this.estimatedUsd+=e.usage.conservativeEstimatedUsd;
   if(this.estimatedUsd+this.plan.previousUnmeteredReservationUsd>this.plan.ceilingUsd)throw new Error('COST_LIMIT_VIOLATION');
   e.interpretation=parseChatResponse(e.raw);e.validation=assertAccepted(e.interpretation,context,intent);
   e.status='VALIDATED_UNCONFIRMED_PROPOSAL';await this.saveEvidence(e);return e.interpretation;
  }catch(error){
   this.stop(error.code??error.message);e.status='STOPPED';e.latencyMs=performance.now()-start;
   e.error={code:error.code??error.message,diagnostics:error.diagnostics??null,service:error.service??null};await this.saveEvidence(e);throw error;
  }finally{this.busy=false;}
 }
}
