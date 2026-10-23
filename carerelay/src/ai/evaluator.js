// Diagnostic evaluation never exits early on schema failure. Observable errors
// are measured separately; absent/malformed dimensions are UNKNOWN, not zero.
export function diagnose(raw,item,{shapeErrors=[]}={}){
 const expected=item.expected,messages=new Map(item.input.originalMessages.map(m=>[m.id,m.text]));
 const result={shapeErrors,structureValid:shapeErrors.length===0,provenance:{checked:0,unsupported:0,unknown:0},unsupportedPeople:0,unsupportedTimes:0,coverage:{},semanticReview:'PENDING',semanticPass:null};
 for(const key of ['facts','responsibilities','shifts','corrections']){
  const rows=raw?.[key],gold=expected[key]??[];
  if(!Array.isArray(rows)){result.coverage[key]={status:'UNKNOWN',expected:gold.length,found:null,missing:null,extra:null,slotErrors:null};continue;}
  const used=new Set();let found=0,slotErrors=0;
  const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  for(const e of gold){const matches=rows.map((r,i)=>({r,i})).filter(({r,i})=>!used.has(i)&&r?.evidence?.messageId===e.messageId&&typeof r.evidence.quote==='string'&&r.evidence.quote.includes(e.anchor));const check=r=>key==='responsibilities'?r.temporal===e.temporal&&r.ownership===e.ownership&&same(r.candidates,e.candidates)&&r.timeText===e.timeText:key==='shifts'?r.caregiverText===e.caregiverText&&r.startsAt===e.startsAt&&r.endsAt===e.endsAt:key==='corrections'?r.targetId===e.targetId:true;const p=matches.find(x=>check(x.r))??matches[0];if(p){used.add(p.i);found++;if(!check(p.r))slotErrors++;}}
  result.coverage[key]={status:'MEASURED',expected:gold.length,found,missing:gold.length-found,extra:rows.length-used.size,slotErrors};
 }
 for(const key of ['people','facts','responsibilities','shifts','corrections']){
  if(!Array.isArray(raw?.[key])){result.provenance.unknown++;continue;}
  for(const r of raw[key]){
   const q=r?.evidence?.quote,t=messages.get(r?.evidence?.messageId);result.provenance.checked++;
   if(typeof q!=='string'||!q.trim()||typeof t!=='string'||!t.includes(q))result.provenance.unsupported++;
   const names=key==='people'?[r?.mention]:key==='shifts'?[r?.caregiverText]:key==='responsibilities'?r?.candidates:[];
   if(Array.isArray(names))for(const n of names){if(typeof n!=='string'||typeof q!=='string'||!new RegExp(`(?<![\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'iu').test(q))result.unsupportedPeople++;}
   for(const time of [r?.startsAt,r?.endsAt,r?.timeText].filter(v=>v!=null))if(typeof q!=='string'||!q.includes(time))result.unsupportedTimes++;
  }
 }
 result.falseCompletion=Array.isArray(raw?.responsibilities)?raw.responsibilities.filter(r=>r?.temporal==='reported_complete'&&!expected.responsibilities.some(e=>e.temporal==='reported_complete'&&r.evidence?.messageId===e.messageId&&(typeof r.evidence?.quote==='string'&&r.evidence.quote.includes(e.anchor)))).length:null;
 result.ownershipErrors=Array.isArray(raw?.responsibilities)?raw.responsibilities.filter(r=>!expected.responsibilities.some(e=>r?.evidence?.messageId===e.messageId&&(typeof r.evidence?.quote==='string'&&r.evidence.quote.includes(e.anchor))&&r.ownership===e.ownership&&Array.isArray(r.candidates)&&JSON.stringify([...r.candidates].sort())===JSON.stringify([...e.candidates].sort()))).length:null;
 result.clarification=typeof raw?.clarification?.needed==='boolean'?{status:'MEASURED',correct:raw.clarification.needed===expected.clarification}:{status:'UNKNOWN',correct:null};
 result.intentCorrect=typeof raw?.intent==='string'?raw.intent===expected.intent:null;
 result.boundaryCorrect=typeof raw?.boundary==='string'?raw.boundary===expected.boundary:null;
 result.validMessageRejection=expected.boundary==='coordination'&&(!result.structureValid||result.provenance.unsupported>0||result.unsupportedPeople>0||result.unsupportedTimes>0)?1:0;
 return result;
}
