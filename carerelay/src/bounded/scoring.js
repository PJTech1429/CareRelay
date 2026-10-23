import {literal} from '../ai/evidence.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const norm=s=>(s??'').toLowerCase().replace(/[.!]$/,'').replace(/\s+/g,' ').trim();
// Frozen evaluator-only aliases. They never enter the model prompt or application.
// A novel paraphrase is REVIEW/STOP, not silently accepted as semantic entailment.
export const actionAliases={
 're-cover the garden cushions':['re-cover the garden cushions','re-cover garden cushions','recover the garden cushions','re-covering the garden cushions'],
 'take framed photos to repair shop':['take the framed photos to the repair shop','take framed photos to repair shop','take framed photos to the repair shop','deliver the framed photos to the repair shop'],
 'collect repaired lamp':['collect the repaired lamp','collect repaired lamp','collected the repaired lamp','collecting the repaired lamp'],
 'bring folding chairs':['bring the folding chairs','bring folding chairs','bringing the folding chairs'],
 'sweep front step':['sweep the front step','sweep front step','sweeping the front step'],
 'return library atlas':['return the library atlas','return library atlas','return the atlas','return it']
};
const actionTimes={'re-cover the garden cushions':[' on Friday',' Friday'],'take framed photos to repair shop':[' on Tuesday',' Tuesday'],'bring folding chairs':[' tomorrow'],'return library atlas':[' after lunch']};
export const matchesAction=(actual,meaning)=>(actionAliases[meaning]??[]).some(a=>['',...(actionTimes[meaning]??[])].some(t=>norm(a+t)===norm(actual)));
const evidenceClauses={
 're-cover the garden cushions':['I can re-cover the garden cushions'],
 'take framed photos to repair shop':['I will take the framed photos to the repair shop'],
 'collect repaired lamp':['Jules has already collected the repaired lamp.'],
 'bring folding chairs':['Either Lena or Omar may bring the folding chairs'],
 'sweep front step':['The front step still needs sweeping.'],
 'return library atlas':['I will return it after lunch.']
};
export function scoreUpdate(c,raw){
 const e=c.expected,r=raw?.responsibilities??[],shifts=raw?.shifts??[];
 const checks={boundary:raw?.boundary==='coordination',intent:raw?.intent==='update',responsibilityCount:r.length===e.responsibilities.length,
  factCount:raw?.facts?.length===e.facts.length,shiftCount:shifts.length===e.shifts.length,
  facts:e.facts.every(f=>raw?.facts?.some(x=>norm(x.evidence?.quote)===norm(f))),
  supportedPeople:Array.isArray(raw?.people)&&raw.people.every(p=>[...e.responsibilities.flatMap(x=>x.candidates),...e.shifts.map(x=>x.caregiverText)].some(n=>norm(n)===norm(p.mention))&&literal(c.message,p.mention)&&literal(p.evidence?.quote??'',p.mention)),
  review:Array.isArray(raw?.review)&&(c.id==='S4'?raw.review.every(x=>x.evidence?.quote==='I have not returned the library atlas.'):raw.review.length===0)};
 const used=new Set(),details=[];
 for(const expected of e.responsibilities){
  const idx=r.findIndex((x,i)=>!used.has(i)&&matchesAction(x.action,expected.meaning));
  if(idx>=0)used.add(idx);const actual=r[idx];
  const row={meaning:expected.meaning,action:idx>=0,ownership:actual?.ownership===expected.ownership,temporal:actual?.temporal===expected.temporal,candidates:same([...(actual?.candidates??[])].sort(),[...expected.candidates].sort()),time:actual?.timeText===expected.timeText};
  row.evidenceMeaning=(evidenceClauses[expected.meaning]??[]).some(clause=>actual?.evidence?.quote?.includes(clause.replace(/[.!]$/,'')));
  details.push(row);
 }
 checks.actions=details.every(x=>x.action);checks.evidenceMeaning=details.every(x=>x.evidenceMeaning);checks.ownership=details.every(x=>x.ownership&&x.candidates);checks.completion=details.every(x=>x.temporal);checks.times=details.every(x=>x.time);
 checks.shifts=e.shifts.every(x=>shifts.some(s=>norm(s.caregiverText)===norm(x.caregiverText)&&s.startsAt===x.startsAt&&s.endsAt===x.endsAt));
 const falseCompletion=r.filter(x=>x.temporal==='reported_complete'&&!e.responsibilities.some(y=>y.temporal==='reported_complete'&&matchesAction(x.action,y.meaning))).length;
 return {caseId:c.id,checks,details,falseCompletion,ownershipErrors:details.filter(x=>!x.ownership||!x.candidates).length,shiftErrors:checks.shifts&&checks.shiftCount?0:1,passed:Object.values(checks).every(Boolean),reviewRequired:true,scoring:'FIXED_FIELD_AND_ACTION_ALIAS_CHECKS; independent full semantic review still required'};
}
export function scoreContinuation(c,raw,targetId){
 const e=c.expected,checks={boundary:raw?.boundary==='coordination',intent:raw?.intent===c.intent,owner:raw?.ownerText===e.ownerText,
  actionPreserved:raw?.actionText===null||matchesAction(raw?.actionText,e.taskMeaning),currentEvidence:raw?.evidence?.quote===c.message};
 if(c.intent==='clarification')Object.assign(checks,{decision:raw?.decision===e.decision,target:raw?.proposalId===targetId});
 else Object.assign(checks,{operation:raw?.operation===e.operation,target:same(raw?.targetIds,[targetId])});
 return {caseId:c.id,checks,passed:Object.values(checks).every(Boolean),falseCompletion:raw?.operation==='complete'?1:0,ownershipErrors:checks.owner?0:1,reviewRequired:true,scoring:'FIXED_CONTINUATION_CHECKS; independent full semantic review still required'};
}
