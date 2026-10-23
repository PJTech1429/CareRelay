
// Development-only grammatical stub. No model inference and no accuracy claim.
// Unknown language is retained for review, not turned into invented actions.
const base=intent=>({version:2,intent,boundary:'coordination'});
const span=(m,quote)=>{const start=m.text.indexOf(quote);return {messageId:m.id,start,end:start+quote.length,quote};};
export class OfflineMockProvider{
 constructor(){this.provider='offline-mock';}
 health(){return {provider:this.provider,ready:true,liveInference:false,label:'OFFLINE MOCK · no model inference',capability:'Bounded English grammar for workflow testing; unfamiliar phrasing needs review'};}
 async interpret(context,intent){
  const m=context.originalMessages.find(x=>x.id===context.currentMessageId),text=m.text.trim(),evidence=span(m,text);
  if(intent==='question')return {...base(intent),scope:/\b(my|mine|for me)\b/i.test(text)?'mine':/\b(open|unresolved|unassigned)\b/i.test(text)?'open':/\b(completed|finished)\b/i.test(text)?'completed':/\bshift/i.test(text)?'shifts':/what (?:changed|happened)|handoff|responsibilit|tasks|updates/i.test(text)?'all':'unknown'};
  if(intent==='clarification'){
   const owner=text.match(/^(?:assign (?:it|this) to |owner\s*:\s*|)([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})[.!]?$/u)?.[1]??text.match(/\b([\p{Lu}][\p{L}'’-]*|I)\s+(?:will|shall)\s+/u)?.[1]??null;
   const certain=owner&&!/\b(?:or|someone|maybe|unsure|not|nobody|no one|unknown|anyone|everyone)\b/i.test(owner);
   return {...base(intent),proposalId:context.pending.id,ownerText:certain?owner:null,actionText:null,decision:certain?'resolve':'uncertain',evidence};
  }
  if(intent==='correction'){
   const number=text.match(/\btask\s+(\d+)\b/i)?.[1];
   const targets=number?[context.verifiedRecords[Number(number)-1]?.id].filter(Boolean):context.selectedTaskId?[context.selectedTaskId]:context.verifiedRecords.length===1?[context.verifiedRecords[0].id]:[];
   const owner=text.match(/\bto\s+([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*)?)/u)?.[1]??null;
   const operation=/\bcancel\b/i.test(text)?'cancel':/\b(reassign|owner)\b/i.test(text)?'replace_owner':/\b(complete|completed|done)\b/i.test(text)?'complete':/\b(change|revise|instead|actually)\b/i.test(text)?'revise':'uncertain';
   return {...base(intent),targetIds:targets,operation,ownerText:owner,actionText:operation==='revise'?text:null,evidence};
  }
  const out={...base('update'),people:[],facts:[],responsibilities:[],shifts:[],review:[]};
  const clauses=text.split(/(?<=[.!?;])\s+|\n+|\s+and\s+(?=(?:[A-Z][\p{L}]+|I|someone)\s+(?:will|can|must|needs?))/u).filter(Boolean);
  for(const clause of clauses){
   const e=span(m,clause),q=clause.replace(/[.!;]$/,'');
   const shift=q.match(/^(I|My(?:\s+\w+)? shift|[\p{Lu}][\p{L}]+['’]s(?:\s+\w+)? shift)\s+(starts?|ends?|leave|arrive)\s+at\s+(.+)$/u);
   if(shift&&!/\b(?:not|if|maybe)\b/i.test(q)){const who=shift[1].startsWith('My')?'My':shift[1].replace(/['’]s.*$/,'');out.shifts.push({caregiverText:who,startsAt:/start|arrive/.test(shift[2])?shift[3]:null,endsAt:/end|leave/.test(shift[2])?shift[3]:null,evidence:e});continue;}
   if(/^(?:please\s+)?(?:do not|don't|never)\b/i.test(q)){out.facts.push({evidence:e});continue;}
   const frame=q.match(/^(.+?)\s+(will|shall|can|could|might|may|must|should|needs? to|has not|have not|did not|didn't|hasn't|haven't)\s+(.+)$/i);
   if(frame){
    const subject=frame[1],modal=frame[2].toLowerCase(),action=frame[3];
    const mentions=subject.replace(/^either\s+/i,'').split(/\s+or\s+|\s+and\s+/i).map(x=>x.trim()).filter(x=>/^(?:I|[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*)?)$/u.test(x)&&! /^(Someone|Nobody|Everyone|Anyone)$/i.test(x));
    const ownership=mentions.length>1?'ambiguous':!mentions.length?'missing':/can|could|might|may/.test(modal)?'offered':/will|shall/.test(modal)?'reported_commitment':'uncertain';
    out.responsibilities.push({action,evidence:e,temporal:/not|n't/.test(modal)?'negated':'pending',ownership,candidates:mentions,timeText:null});continue;
   }
   if(/\b(?:needs?|requires?|pending|unassigned)\b/i.test(q)){out.responsibilities.push({action:q,evidence:e,temporal:'pending',ownership:'missing',candidates:[],timeText:null});continue;}
   if(/^(?:I|[\p{Lu}][\p{L}]+)\s+(?:(?:have|has)\s+)?(?:already\s+)?[\p{L}]+ed\b/u.test(q)){
    out.responsibilities.push({action:q,evidence:e,temporal:'reported_complete',ownership:'reported_commitment',candidates:[q.split(' ')[0]],timeText:null});continue;
   }
   if(/\b(?:is|are|was|were)\b/i.test(q)){out.facts.push({evidence:e});continue;}
   out.review.push({evidence:e,reason:'Offline grammar cannot interpret this wording. Restate the action with “will”, “can”, or “needs”, or retain it as a report.'});
  }
  return out;
 }
}
export class ReplayProvider{
 constructor(responses){this.responses=[...responses];this.provider='offline-replay';}
 health(){return {provider:this.provider,ready:true,liveInference:false,label:'OFFLINE REPLAY · fixture responses'};}
 async interpret(context,intent){if(!this.responses.length)throw new Error('Replay exhausted; no live fallback');const response=this.responses.shift();return structuredClone(typeof response==='function'?response(context,intent):response);}
}
