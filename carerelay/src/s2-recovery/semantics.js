import {createHash} from 'node:crypto';
import {contracts} from '../ai/intent-router.js';
import {shapeErrors,literal} from '../ai/evidence.js';
import {validateInterpretation,resolveSpeaker} from '../integration-recovery/validation.js';
import {projectUpdate} from '../ai/proposal-adapter.js';
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sameEvidence=(a,b)=>a.messageId===b.messageId&&a.start===b.start&&a.end===b.end&&a.quote===b.quote;
const normalized=s=>s.toLowerCase().replace(/[.!]$/,'').replace(/\s+/g,' ').trim();
const actor=(name,e,context)=>resolveSpeaker(name,e,context)?.resolvedCaregiver??name;
const unsafe=q=>/\b(?:not|never|neither|if|maybe|may|might|could|can|available|availability|free|offered|offer)\b|n['’]t\b/i.test(q);
function sourceActor(name,e,context){return resolveSpeaker(name,e,context)?.sourceReference??name;}
// Full-clause schedule grammar. No caregiver name, clock value or case ID is
// embedded here. Compound clauses cannot be erased by sharing a citation.
export function pureShift(shift,context){
 if(!shift.startsAt||!shift.endsAt||unsafe(shift.evidence.quote))return false;
 const who=esc(sourceActor(shift.caregiverText,shift.evidence,context));
 const interval=`(?:from\\s+)?${esc(shift.startsAt)}\\s*(?:to|until|[-–])\\s*${esc(shift.endsAt)}`;
 const patterns=[
  `^${who}\\s+(?:is|am|are|will be)\\s+(?:covering|on duty|on shift)\\s+${interval}[.!]?$`,
  `^${who}\\s+(?:will cover|is covering|am covering|are covering)\\s+(?:the\\s+)?(?:(?:morning|afternoon|evening|night|overnight)\\s+)?shift\\s+${interval}[.!]?$`,
  `^${who}(?:['’]s)?\\s+shift\\s+(?:runs|is|lasts)\\s+${interval}[.!]?$`
 ];
 return patterns.some(p=>new RegExp(p,'i').test(shift.evidence.quote.trim()));
}
function scheduleAction(row,shift){
 const a=normalized(row.action),interval=`(?:from\\s+)?${esc(shift.startsAt.toLowerCase())}\\s*(?:to|until|[-–])\\s*${esc(shift.endsAt.toLowerCase())}`;
 return new RegExp(`^(?:(?:cover|covering)(?: (?:the )?(?:(?:morning|afternoon|evening|night|overnight) )?shift)?|(?:be )?on duty|(?:be )?on shift)(?: ${interval})?$`,'i').test(a);
}
function progressive(row,context){
 if(row.candidates.length!==1||row.temporal!=='pending'||row.ownership!=='reported_commitment'||unsafe(row.evidence.quote))return null;
 const who=sourceActor(row.candidates[0],row.evidence,context);
 if(!literal(row.evidence.quote,who))return null;
 const m=row.evidence.quote.match(new RegExp(`^${esc(who)}\\s+(?:is|am|are)\\s+([\\p{L}]+ing)\\b(.+)[.!]?$`,'iu'));
 if(!m)return null;
 return /^taking\s+responsibility\s+for\b|^committing\s+to\b/i.test(m[1]+m[2])?'explicit_progressive_commitment':'activity_requires_review';
}
function reject(errors,base={}){throw Object.assign(new Error('Interpretation rejected safely. No household change was made.'),{code:'INVALID_PROPOSAL',diagnostics:{...base,accepted:false,errors,policy:'semantic-projection-v1'}});}
export function validateWithProjection(raw,context,intent){
 const shape=shapeErrors(raw,contracts[intent]);if(shape.length)reject(shape);
 if(intent!=='update')return validateInterpretation(raw,context,intent);
 let old;try{old=validateInterpretation(raw,context,intent);}catch(e){if(e.code!=='INVALID_PROPOSAL')throw e;old=e.diagnostics;}
 const acceptedProgressive=new Map();raw.responsibilities.forEach((r,i)=>{const kind=progressive(r,context);if(kind)acceptedProgressive.set(`responsibilities.${i}`,kind);});
 // Only the narrow grammar-rejection code is replaceable. Evidence, actor,
 // time, action, offers, completion and all other safety failures stay fatal.
 const errors=old.errors.filter(e=>!(e.code==='UNSUPPORTED_COMMITMENT'&&acceptedProgressive.has(e.path)));
 if(errors.length)reject(errors,old);
 const derived=structuredClone(raw),dispositions=[],seenShifts=new Map();derived.shifts=[];
 for(const [index,s] of raw.shifts.entries()){
  const key=JSON.stringify([s.evidence,actor(s.caregiverText,s.evidence,context),s.startsAt,s.endsAt]);
  if(seenShifts.has(key)){dispositions.push({sourcePath:`shifts.${index}`,kind:'duplicate_shift',representedBy:`shifts.${seenShifts.get(key)}`,evidence:structuredClone(s.evidence)});}
  else{seenShifts.set(key,index);derived.shifts.push(structuredClone(s));}
 }
 derived.responsibilities=[];
 for(const [index,row]of raw.responsibilities.entries()){
  const match=raw.shifts.findIndex(s=>sameEvidence(row.evidence,s.evidence)&&pureShift(s,context)&&scheduleAction(row,s)&&row.candidates.length===1&&actor(row.candidates[0],row.evidence,context)===actor(s.caregiverText,s.evidence,context)&&row.temporal==='pending'&&row.ownership==='reported_commitment'&&(row.timeText===null||(row.timeText.includes(s.startsAt)&&row.timeText.includes(s.endsAt))));
  if(match>=0){dispositions.push({sourcePath:`responsibilities.${index}`,kind:'shift_not_separate_task',representedBy:`shifts.${match}`,evidence:structuredClone(row.evidence)});continue;}
  if(acceptedProgressive.get(`responsibilities.${index}`)==='activity_requires_review'){
   if(!derived.review.some(r=>sameEvidence(r.evidence,row.evidence)))derived.review.push({evidence:structuredClone(row.evidence),reason:'Activity described; clarify whether this is an actionable responsibility and who accepts it.'});
   dispositions.push({sourcePath:`responsibilities.${index}`,kind:'activity_requires_review',evidence:structuredClone(row.evidence)});continue;
  }
  derived.responsibilities.push(structuredClone(row));
 }
 const derivedShape=shapeErrors(derived,contracts.update);if(derivedShape.length)reject(derivedShape,old);
 return {...old,accepted:true,errors:[],policy:'semantic-projection-v1',applicationInterpretation:derived,projection:{rawInterpretationSha256:hash(raw),applicationInterpretationSha256:hash(derived),dispositions,rawMutated:false},semanticValidation:'Conservative source-grounded classification; not general model reliability.'};
}
export function projectSemanticUpdate(raw,envelope,session,diagnostics){
 if(!diagnostics?.accepted||diagnostics.projection?.rawInterpretationSha256!==hash(raw)||diagnostics.projection?.applicationInterpretationSha256!==hash(diagnostics.applicationInterpretation))throw new Error('INVALID_SEMANTIC_PROJECTION');
 return projectUpdate(diagnostics.applicationInterpretation,envelope,session);
}
