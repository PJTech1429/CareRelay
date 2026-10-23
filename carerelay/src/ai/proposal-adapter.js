
import {randomUUID} from 'node:crypto';
const bind=(name,speaker)=>/^(?:I|my)$/i.test(name)?speaker:name;
export function projectUpdate(raw,envelope,session){
 const common={messageId:envelope.id,sessionId:session.id,reportedBy:session.caregiver,createdAt:new Date().toISOString(),version:1};
 const proposals=raw.responsibilities.map(row=>({...common,id:randomUUID(),kind:'responsibility',action:row.action,evidence:[row.evidence],interpretation:structuredClone(row),proposedOwner:row.candidates.length===1?bind(row.candidates[0],session.caregiver):null,ownerBinding:row.candidates.some(n=>/^(I|my)$/i.test(n))?'caller_metadata_from_literal_pronoun':'literal_mention',owner:null,status:row.temporal==='reported_complete'?'Awaiting Confirmation':row.ownership==='reported_commitment'?'Awaiting Confirmation':'Unresolved',needsClarification:row.temporal==='uncertain'||(row.temporal!=='reported_complete'&&row.ownership!=='reported_commitment'),confirmationEffect:row.temporal==='reported_complete'?'record_completion_report':'assign_responsibility'}));
 for(const row of raw.review)proposals.push({...common,id:randomUUID(),kind:'review',action:row.evidence.quote,evidence:[row.evidence],reason:row.reason,owner:null,proposedOwner:null,status:'Unresolved',needsClarification:true});
 return {proposals,facts:raw.facts.map(r=>({...common,id:randomUUID(),statement:r.evidence.quote,evidence:r.evidence,verification:'caregiver_report_not_independently_verified'})),shifts:raw.shifts.map(r=>({...common,id:randomUUID(),...r,caregiver:bind(r.caregiverText,session.caregiver),binding:/^(I|my)$/i.test(r.caregiverText)?'caller_metadata_from_literal_pronoun':'literal_mention',verification:'reported_schedule'}))};
}
