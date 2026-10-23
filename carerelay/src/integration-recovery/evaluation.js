import {scoreUpdate} from '../bounded/scoring.js';
// Evaluation-only equivalence. Never rewrite quotations, offsets, source
// messages or production model fields. No relative-date calendar inference.
export function canonicalTime(value){
 if(value===null)return null;if(typeof value!=='string')return value;
 const s=value.trim().toLowerCase().replace(/\s+/g,' ');
 const day=s.match(/^(?:on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);if(day)return `weekday:${day[1]}`;
 const clock=s.match(/^(?:at )?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/);
 if(clock){let h=Number(clock[1]),m=Number(clock[2]??0);if(h>=1&&h<=12&&m<60)return `clock:${(h%12+(clock[3]==='p'?12:0))*60+m}`;}
 const clock24=s.match(/^(?:at )?(\d{2}):(\d{2})$/);if(clock24&&Number(clock24[1])<24&&Number(clock24[2])<60)return `clock:${Number(clock24[1])*60+Number(clock24[2])}`;
 return s;
}
export function scoreEquivalent(c,raw,diagnostics){
 const expected=structuredClone(c),candidate=structuredClone(raw);
 for(const r of expected.expected.responsibilities)r.timeText=canonicalTime(r.timeText);
 for(const r of candidate.responsibilities)r.timeText=canonicalTime(r.timeText);
 for(const r of expected.expected.shifts){r.startsAt=canonicalTime(r.startsAt);r.endsAt=canonicalTime(r.endsAt);}
 for(const [i,r] of candidate.shifts.entries()){
  r.startsAt=canonicalTime(r.startsAt);r.endsAt=canonicalTime(r.endsAt);
  const b=diagnostics.bindings.find(b=>b.path===`shifts.${i}`);
  if(b)r.caregiverText=b.sourceReference;
 }
 return {policy:'equivalence-v3',historicalScore:scoreUpdate(c,raw),equivalentScore:scoreUpdate(expected,candidate),contractAccepted:diagnostics.accepted,passed:diagnostics.accepted&&scoreUpdate(expected,candidate).passed,sourceOrExpectationMutated:false};
}
