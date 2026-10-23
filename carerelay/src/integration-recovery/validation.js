import {inspect,literal,shapeErrors} from '../ai/evidence.js';
import {contracts} from '../ai/intent-router.js';
import {evidenceIndex} from '../ai/evidence-index.js';
const first=x=>/^(?:I|my|me|mine|myself)$/i.test(x??'');
const stopWords=new Set('a an the to of on in at for with from by and or is are was were be been being has have had already i my me mine myself will shall can could may might must should needs need not no never'.split(' '));
const words=s=>(s.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).filter(w=>!stopWords.has(w));
const stem=s=>s.replace(/(?:ing|ed|s)$/,'').replace(/e$/,'');
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const fail=diagnostics=>{throw Object.assign(new Error('Interpretation rejected safely. No household change was made.'),{code:'INVALID_PROPOSAL',diagnostics});};
export function resolveSpeaker(reference,evidence,context){
 if(!first(reference))return null;
 const source=context.originalMessages.find(m=>m.id===evidence?.messageId),metadata=context.speakersByMessage?.[evidence?.messageId];
 if(!source||!metadata?.caregiver||metadata.source!=='caller_metadata_not_quotation')return null;
 const sentence=evidenceIndex([source]).find(s=>s.start<=evidence.start&&s.end>=evidence.end);
 // Direct first-person source only. Do not attribute a quoted "I" in someone
 // else's reported speech, hypothetical, negated attribution or third-person clause.
 const anchor=sentence?.quote.match(/^(I|My|Me|Mine|Myself)\b/i)?.[1];
 if(!anchor||!new RegExp(`^(?:I|My|Me|Mine|Myself)\\b`,'i').test(evidence.quote)||/["“”]/.test(sentence.quote)||/\b(?:said|says|told|quoted|wrote|if)\b.*[:"“]/i.test(sentence.quote))return null;
 // Possessive relatives ("My brother's shift") are not the caller's shift.
 // Restrict possessive resolution to an explicit first-person shift phrase.
 if(anchor.toLowerCase()!=='i'&&!/^My\s+(?:(?:morning|afternoon|evening|night|overnight|next|current|caregiving|weekend|day|early|late)\s+)*shift\b/i.test(sentence.quote))return null;
 return {reference,sourceReference:anchor,resolvedCaregiver:metadata.caregiver,sourceMessageId:source.id,source:'caller_metadata_not_quotation'};
}
function attributedSubject(row,context){
 const quote=row.evidence.quote;
 if(row.candidates.length!==1)return false;
 const who=row.candidates[0];
 const subject=first(who)?'I':esc(who);
 if(first(who)&&!resolveSpeaker(who,row.evidence,context))return false;
 return new RegExp(`^${subject}\\s+(?:will|shall|can|could|may|might|has|have|already|[\\p{L}]+ed)\\b`,'iu').test(quote);
}
export function validateInterpretation(raw,context,intent){
 const shape=shapeErrors(raw,contracts[intent]);if(shape.length)fail({accepted:false,errors:shape,policy:'evidence-identity-v3'});
 const legacy=inspect(raw,context,intent),bindings=[],rows=[];
 for(const category of ['people','facts','responsibilities','shifts','review'])for(const [i,row] of (raw[category]??[]).entries())rows.push({row,category,path:`${category}.${i}`});
 if(raw.evidence)rows.push({row:raw,category:intent,path:intent});
 const allowedAliases=new Set();
 for(const {row,category,path} of rows){
  const names=category==='people'?[row.mention]:category==='shifts'?[row.caregiverText]:category==='responsibilities'?row.candidates:row.ownerText?[row.ownerText]:[];
  let allSupported=true;
  for(const name of names){
   const resolved=resolveSpeaker(name,row.evidence,context);
   if(first(name)){
    if(resolved)bindings.push({path,...resolved});else allSupported=false;
   }else if(!literal(row.evidence.quote,name))allSupported=false;
  }
  if(allSupported)allowedAliases.add(path);
 }
 const errors=legacy.errors.filter(e=>!(e.code==='UNSUPPORTED_PERSON'&&allowedAliases.has(e.path)));
 for(const {row,category,path} of rows){
  const quote=row.evidence.quote;
  const names=category==='people'?[row.mention]:category==='shifts'?[row.caregiverText]:category==='responsibilities'?row.candidates:row.ownerText?[row.ownerText]:[];
  for(const name of names)if(first(name)&&!resolveSpeaker(name,row.evidence,context))errors.push({code:'UNSUPPORTED_SPEAKER_REFERENCE',path});
  if(category==='responsibilities'){
   const evidenceWords=new Set(words(quote).map(stem));
   if(!words(row.action).length||words(row.action).some(w=>!evidenceWords.has(stem(w))))errors.push({code:'UNSUPPORTED_ACTION_CONTENT',path});
   const uncertain=/\b(?:can|could|may|might|offer|offered|would|if)\b/i.test(quote),future=/\b(?:will|shall|promis(?:e|ed|es|ing)|plan(?:ned|s|ning)?|intend(?:ed|s)?|going to|about to|tomorrow)\b/i.test(quote),negated=/\b(?:not|never|neither|nobody)\b|n['’]t\b/i.test(quote);
   if(row.temporal==='reported_complete'&&(uncertain||future||negated))errors.push({code:'FALSE_COMPLETION_RISK',path});
   if(row.ownership==='reported_commitment'&&(uncertain||negated||!attributedSubject(row,context)))errors.push({code:'UNSUPPORTED_COMMITMENT',path});
   if(row.ownership==='offered'&&(!uncertain||!attributedSubject(row,context)))errors.push({code:'UNSUPPORTED_OFFER_ATTRIBUTION',path});
   if(row.temporal==='reported_complete'&&!/\b(?:already|completed|finished|done|collected|returned|delivered|took|brought|made|sent|fixed|repaired|[\p{L}]+ed)\b/iu.test(quote))errors.push({code:'COMPLETION_NOT_SUPPORTED',path});
  }
  if(category==='clarification'&&raw.decision==='resolve'){
   if(!raw.ownerText||/\b(?:not|never|neither|or|maybe|can|could|might|may)\b/i.test(quote)||!(/^Owner:\s*[\p{L}][\p{L}'’ -]*[.!]?$/u.test(quote)||/\b(?:will|shall)\b/i.test(quote)))errors.push({code:'CLARIFICATION_NOT_COMMITMENT',path});
   if(raw.actionText!==null&&context.pending?.action!==raw.actionText)errors.push({code:'CLARIFICATION_ALTERS_ACTION',path});
   if(!/^Owner:/i.test(quote)&&words(context.pending?.action??'').some(w=>!new Set(words(quote).map(stem)).has(stem(w))))errors.push({code:'CLARIFICATION_WRONG_ACTION',path});
  }
  if(category==='shifts'){
   if(!/\b(?:shift|covering|duty)\b/i.test(quote))errors.push({code:'UNSUPPORTED_SHIFT',path});
   if(/\b(?:not|never|if|maybe|might|may|or)\b|n['’]t\b/i.test(quote))errors.push({code:'UNCERTAIN_OR_NEGATED_SHIFT',path});
   const range=row.startsAt&&row.endsAt&&new RegExp(`${esc(row.startsAt)}\\s*(?:to|until|[-–])\\s*${esc(row.endsAt)}`,'i').test(quote);
   if(row.startsAt&&!range&&!new RegExp(`\\b(?:starts?|begins?|arrives?)\\s+(?:at\\s+)?${esc(row.startsAt)}`,'i').test(quote))errors.push({code:'ALTERED_SHIFT_START',path});
   if(row.endsAt&&!range&&!new RegExp(`\\b(?:ends?|finishes?|leaves?)\\s+(?:at\\s+)?${esc(row.endsAt)}`,'i').test(quote))errors.push({code:'ALTERED_SHIFT_END',path});
  }
  if(category==='correction'&&raw.operation==='complete'&&/\b(?:will|can|could|may|might|not|tomorrow)\b|n['’]t\b/i.test(quote))errors.push({code:'FALSE_COMPLETION_RISK',path});
  if(category==='correction'){
   const target=context.verifiedRecords.find(t=>t.id===raw.targetIds?.[0]);
   if(raw.actionText!=null){const supported=new Set(words(quote+' '+(target?.title??'')).map(stem));if(words(raw.actionText).some(w=>!supported.has(stem(w))))errors.push({code:'UNSUPPORTED_CORRECTION_ACTION',path});}
   if(raw.timeText!=null&&!quote.includes(raw.timeText))errors.push({code:'UNSUPPORTED_TIME',path});
   if(context.selectedTaskId&&(raw.targetIds.length!==1||raw.targetIds[0]!==context.selectedTaskId))errors.push({code:'SELECTED_TARGET_CONFLICT',path});
   if(raw.ownerText){
    const actor=esc(raw.ownerText);
    if(/\b(?:not|never|neither|maybe|might|may|could|can)\b|n['’]t\b/i.test(quote)||!new RegExp(`(?:\\b${actor}\\s+(?:will|shall|is responsible)|\\b(?:assign|reassign|change|switch)\\b[^.!?]*\\bto\\s+${actor}\\b)`,'iu').test(quote))errors.push({code:'CORRECTION_OWNER_NOT_SUPPORTED',path});
   }
  }
 }
 const diagnostics={accepted:errors.length===0,errors,evidenceChecked:legacy.evidenceChecked,bindings,policy:'evidence-identity-v3',semanticValidation:'Conservative source-grounding and modal/actor checks; not general entailment proof.'};
 if(!diagnostics.accepted)fail(diagnostics);return diagnostics;
}
