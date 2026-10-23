// A validated review projection is not acceptance of the original interpretation.
// Exact spans, schema, actor grounding and false-completion checks remain hard gates.
import {createHash} from 'node:crypto';
import {validateWithProjection} from '../s2-recovery/semantics.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reviewable=new Set(['UNSUPPORTED_TIME','UNSUPPORTED_ACTION_CONTENT','UNSUPPORTED_COMMITMENT','UNSUPPORTED_OFFER_ATTRIBUTION']);
const key=e=>JSON.stringify([e.messageId,e.start,e.end,e.quote]);
export function validateForReview(raw,context,intent){
 let strict,originalErrors=[];
 try{strict=validateWithProjection(raw,context,intent);}catch(error){
  const errors=error.diagnostics?.errors;
  // Never salvage malformed envelopes/schema, fabricated quotes/people, wrong
  // source IDs, false completion, wrong correction targets or shifted dates.
  if(intent!=='update'||error.code!=='INVALID_PROPOSAL'||!errors?.length||errors.some(e=>!reviewable.has(e.code)||!/^responsibilities\.\d+$/.test(e.path)))throw error;
  originalErrors=structuredClone(errors);
 }
 if(intent!=='update')return strict;
 const source=strict?.applicationInterpretation??raw,derived=structuredClone(source),dispositions=[],reviewDetails=[];
 const affected=new Set(originalErrors.map(e=>Number(e.path.split('.')[1])));
 derived.responsibilities=[];
 for(const [index,row]of source.responsibilities.entries()){
  if(row.temporal==='negated'){
   dispositions.push({sourcePath:`responsibilities.${index}`,kind:'negated_report_not_active_responsibility',evidence:structuredClone(row.evidence)});continue;
  }
  if(!affected.has(index)){derived.responsibilities.push(structuredClone(row));continue;}
  const codes=originalErrors.filter(e=>e.path===`responsibilities.${index}`).map(e=>e.code),reason='AI interpretation requires clarification: '+codes.join(', ')+'. Suggested action, timing and owner are not verified. Restate the intended action, timing and accountable caregiver; no assignment has been made.';
  const existing=derived.review.find(r=>key(r.evidence)===key(row.evidence));if(existing)existing.reason=reason;else derived.review.push({evidence:structuredClone(row.evidence),reason});
  const original=context.originalMessages.find(m=>m.id===row.evidence.messageId);
  reviewDetails.push({evidence:structuredClone(row.evidence),suggestedAction:row.action,suggestedTime:row.timeText,suggestedCandidates:structuredClone(row.candidates),unverified:true,errors:codes,sourceContext:original?{messageId:original.id,text:original.text}:null});
  dispositions.push({sourcePath:`responsibilities.${index}`,kind:'unverified_fields_quarantined_for_review',codes,evidence:structuredClone(row.evidence)});
 }
 // Strictly revalidate the reduced interpretation. This does not fill in source
 // spans, infer pronouns/times, invent owners, or promote a model suggestion.
 const checked=validateWithProjection(derived,context,'update'),application=checked.applicationInterpretation;
 return {...checked,policy:'strict-review-projection-v1',originalStrictAccepted:originalErrors.length===0,originalStrictErrors:originalErrors,reviewRequired:reviewDetails.length>0,reviewDetails,applicationInterpretation:application,projection:{rawInterpretationSha256:hash(raw),applicationInterpretationSha256:hash(application),rawMutated:false,dispositions:[...(strict?.projection?.dispositions??[]),...dispositions]},semanticValidation:'Only the derived source-grounded review projection is accepted. Quarantined model fields remain unverified; this is not model-accuracy evidence.'};
}
