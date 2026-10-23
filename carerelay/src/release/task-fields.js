// Canonical persisted task fields; historical proposal fallback is read-only.
export const clockSpans=s=>[...(s??'').matchAll(/\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi)].map(m=>m[0].toLowerCase().replace(/[.\s]/g,''));
export function taskTiming(s,t){
 const source=s.proposals.find(p=>p.id===t.proposalId),value=Object.hasOwn(t,'timeText')?t.timeText:source?.timeText??source?.interpretation?.timeText??null;
 const titleClocks=clockSpans(t.title),timeClocks=clockSpans(value);
 const conflict=titleClocks.length>0&&timeClocks.length>0&&titleClocks.some(x=>!timeClocks.includes(x));
 const needsReview=conflict||t.timingNeedsReview===true;
 return {timeText:needsReview?null:value,timingNeedsReview:needsReview};
}
export function proposalChanges(p){return p.changes??{title:p.operation==='revise'?p.action:null,owner:p.operation==='replace_owner'?p.proposedOwner:null,timeText:null};}
