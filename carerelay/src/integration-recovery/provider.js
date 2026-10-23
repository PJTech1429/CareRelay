import {randomUUID} from 'node:crypto';
import {decodeEnvelope} from './envelope.js';
import {validateInterpretation} from './validation.js';
import {OfflineMockProvider} from '../ai/offline-provider.js';

// Network-free implementation of the corrected AI output boundary. This is
// transport-independent: a future authorized live adapter can use the same
// decoder and validator. This release has no live send/credential capability.
export function acceptModelResponse(raw,context,intent){
 const {value,envelope}=decodeEnvelope(raw);const diagnostics=validateInterpretation(value,context,intent);
 return {interpretation:value,envelope,diagnostics};
}
export class CapturedResponseProvider{
 constructor(capture){
  this.capture=structuredClone(capture);this.original=JSON.parse(capture.request.messages[1].content).originalMessages.at(-1);
  this.provider='offline-captured-kimi-replay';this.events=[];this.scopeParser=new OfflineMockProvider();
 }
 health(){return {provider:this.provider,ready:true,liveInference:false,label:'SAVED KIMI REPLAY · no new inference',capability:'One immutable captured update; manual Owner: clarification; state-based follow-up answers. Not general AI.',replay:true};}
 messageFactory=(text,session)=>{
  if(text===this.original.text){
   if(session.caregiver!==this.capture.speaker)throw new Error('CAPTURE_SPEAKER_MISMATCH');
   return {id:this.original.id,at:this.original.at};
  }
  return {id:randomUUID(),at:new Date().toISOString()};
 };
 async interpret(context,intent){
  const message=context.originalMessages.at(-1);
  if(intent==='update'){
   if(message.text!==this.original.text||message.id!==this.original.id||context.speakersByMessage?.[message.id]?.caregiver!==this.capture.speaker)throw new Error('NO_CAPTURED_RESPONSE_FOR_THIS_MESSAGE');
   const result=acceptModelResponse(this.capture.raw,context,intent);
   this.events.push({source:'GENUINE_SAVED_KIMI_OUTPUT_REPLAY',newInference:false,originalMessageId:message.id,envelope:result.envelope,diagnostics:result.diagnostics});
   return result.interpretation;
  }
  if(intent==='clarification'){
   const match=message.text.match(/^Owner:\s*([\p{L}][\p{L}'’ -]{0,79})$/u);
   if(!match)throw new Error('MANUAL_OWNER_FIELD_REQUIRED: enter Owner: followed by one caregiver name.');
   const value={version:2,boundary:'coordination',intent:'clarification',proposalId:context.pending?.id,ownerText:match[1].trim(),actionText:null,decision:'resolve',evidence:{messageId:message.id,start:0,end:message.text.length,quote:message.text}};
   validateInterpretation(value,context,intent);this.events.push({source:'EXPLICIT_MANUAL_OWNER_FIELD_NOT_AI',newInference:false,messageId:message.id});return value;
  }
  if(intent==='question'){
   const value=await this.scopeParser.interpret(context,intent);validateInterpretation(value,context,intent);this.events.push({source:'OFFLINE_SCOPE_ROUTING_NOT_AI',newInference:false,messageId:message.id});return value;
  }
  throw new Error('NO_CAPTURED_CORRECTION_RESPONSE: no live fallback is enabled.');
 }
}
