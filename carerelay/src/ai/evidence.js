
import {contracts} from './intent-router.js';
export const literal=(text,value)=>typeof value==='string'&&new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'iu').test(text);
export function shapeErrors(value,schema,path='response',out=[]){
 if(schema.anyOf){if(!schema.anyOf.some(s=>shapeErrors(value,s,path,[]).length===0))out.push({code:'SCHEMA_TYPE',path});return out;}
 if(schema.const!==undefined&&value!==schema.const)out.push({code:'SCHEMA_CONST',path});
 if(schema.enum&&!schema.enum.includes(value))out.push({code:'SCHEMA_ENUM',path});
 if(schema.type==='null'&&value!==null)out.push({code:'SCHEMA_NULL',path});
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)){out.push({code:'SCHEMA_OBJECT',path});return out;}
  for(const k of Object.keys(value))if(!Object.hasOwn(schema.properties,k))out.push({code:'SCHEMA_EXTRA',path:`${path}.${k}`});
  for(const k of schema.required)if(!Object.hasOwn(value,k))out.push({code:'SCHEMA_MISSING',path:`${path}.${k}`});
  for(const k of Object.keys(schema.properties))if(Object.hasOwn(value,k))shapeErrors(value[k],schema.properties[k],`${path}.${k}`,out);
 }else if(schema.type==='array'){
  if(!Array.isArray(value)){out.push({code:'SCHEMA_ARRAY',path});return out;}
  if(value.length>32)out.push({code:'SCHEMA_LIMIT',path});
  value.slice(0,33).forEach((v,i)=>shapeErrors(v,schema.items,`${path}.${i}`,out));
 }else if(schema.type==='string'&&(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??4000)))out.push({code:'SCHEMA_STRING',path});
 else if(schema.type==='integer'&&(!Number.isInteger(value)||value<(schema.minimum??0)))out.push({code:'SCHEMA_INTEGER',path});
 return out;
}
export function inspect(raw,context,intent){
 const errors=shapeErrors(raw,contracts[intent]);
 const rows=[];
 for(const k of ['people','facts','responsibilities','shifts','review'])if(Array.isArray(raw?.[k]))raw[k].forEach((row,i)=>rows.push({row,path:`${k}.${i}`,category:k}));
 if(raw?.evidence)rows.push({row:raw,path:intent,category:intent});
 const messages=new Map(context.originalMessages.map(m=>[m.id,m.text]));
 let evidenceChecked=0;
 for(const {row:rawRow,path,category} of rows){
  const row=rawRow&&typeof rawRow==='object'&&!Array.isArray(rawRow)?rawRow:{};
  const e=row?.evidence,text=messages.get(e?.messageId);
  const valid=typeof text==='string'&&Number.isInteger(e?.start)&&Number.isInteger(e?.end)&&e.start>=0&&e.end>e.start&&e.end<=text.length&&typeof e.quote==='string'&&text.slice(e.start,e.end)===e.quote;
  evidenceChecked++;
  if(!valid)errors.push({code:'UNSUPPORTED_PROVENANCE',path});
  const quote=typeof e?.quote==='string'?e.quote:'';
  // An update cannot republish an old report as a new event.
  if(intent==='update'&&e?.messageId!==context.currentMessageId)errors.push({code:'STALE_MESSAGE_EVIDENCE',path});
  const names=category==='people'?[row.mention]:category==='shifts'?[row.caregiverText]:category==='responsibilities'?(Array.isArray(row.candidates)?row.candidates:[]):row.ownerText?[row.ownerText]:[];
  for(const n of names)if(!literal(quote,n))errors.push({code:'UNSUPPORTED_PERSON',path});
  for(const t of [row.startsAt,row.endsAt,row.timeText].filter(v=>v!=null))if(typeof t!=='string'||!quote.includes(t))errors.push({code:'UNSUPPORTED_TIME',path});
  if(category==='responsibilities'){
   if(row.temporal==='reported_complete'&&/\b(?:will|can|could|might|may|promise|plan|offer|tomorrow|not|never)\b|n['’]t\b|['’]ll\b/i.test(quote))errors.push({code:'FALSE_COMPLETION_RISK',path});
   if(row.ownership==='reported_commitment'&&/\b(?:can|could|might|may|offer|offered)\b/i.test(quote))errors.push({code:'OFFER_COMMITMENT_CONFLICT',path});
   if(['missing','ambiguous','offered','uncertain'].includes(row.ownership)===false&&row.candidates?.length!==1)errors.push({code:'OWNER_CARDINALITY',path});
  }
  if(category==='shifts'&&row.startsAt===null&&row.endsAt===null)errors.push({code:'EMPTY_SHIFT',path});
 }
 if(Array.isArray(raw?.targetIds)&&raw.targetIds.some(id=>!context.verifiedRecords.some(r=>r.id===id)))errors.push({code:'UNKNOWN_CORRECTION_TARGET',path:'targetIds'});
 if(intent==='clarification'&&raw?.proposalId!==context.pending?.id)errors.push({code:'WRONG_PENDING_PROPOSAL',path:'proposalId'});
 if(raw?.boundary!=='coordination'&&rows.length)errors.push({code:'BOUNDARY_MUTATION',path:'response'});
 return {accepted:errors.length===0,errors,evidenceChecked,semanticEntailment:'NOT_PROVEN_BY_LITERAL_SPANS'};
}
export function assertAccepted(raw,context,intent){const diagnostics=inspect(raw,context,intent);if(!diagnostics.accepted){const error=new Error('Interpretation rejected safely. No household change was made.');error.code='INVALID_PROPOSAL';error.diagnostics=diagnostics;throw error;}return diagnostics;}
