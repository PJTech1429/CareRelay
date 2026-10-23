import {randomUUID} from 'node:crypto';
import {decodeEnvelope} from '../integration-recovery/envelope.js';
import {validateWithProjection} from './semantics.js';
import {OfflineMockProvider} from '../ai/offline-provider.js';
export class SavedS2Provider{
 constructor(capture,speaker){this.capture=structuredClone(capture);this.speaker=speaker;this.original=JSON.parse(capture.request.messages[1].content).originalMessages.at(-1);this.provider='offline-genuine-s2-replay';this.events=[];this.scope=new OfflineMockProvider();}
 health(){return {provider:this.provider,ready:true,liveInference:false,replay:true,label:'SAVED KIMI S2 REPLAY · zero new inference',capability:'Exact saved update only; questions route offline and read persistent verified state.'};}
 messageFactory=(text,session)=>{if(text===this.original.text){if(session.caregiver!==this.speaker)throw new Error('CAPTURE_SPEAKER_MISMATCH');return {id:this.original.id,at:this.original.at};}return {id:randomUUID(),at:new Date().toISOString()};};
 async interpret(context,intent){
  if(intent==='question'){const result=await this.scope.interpret(context,intent);validateWithProjection(result,context,intent);this.events.push({source:'OFFLINE_QUESTION_SCOPE_NOT_MODEL_INFERENCE'});return result;}
  const m=context.originalMessages.at(-1);
  if(intent!=='update'||m.text!==this.original.text||m.id!==this.original.id||context.speakersByMessage?.[m.id]?.caregiver!==this.speaker)throw new Error('NO_SAVED_OUTPUT_FOR_THIS_INPUT');
  const {value,envelope}=decodeEnvelope(this.capture.raw);const diagnostics=validateWithProjection(value,context,intent);this.events.push({source:'GENUINE_SAVED_KIMI_S2',envelope,newInference:false,projection:diagnostics.projection});return value;
 }
}
