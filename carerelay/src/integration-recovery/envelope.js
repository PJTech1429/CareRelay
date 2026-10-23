// Versioned, explicit envelope policy. No coercion, extraction from prose,
// model-assisted repair, tool execution or retry. Fields are never rewritten.
export const ENVELOPES=Object.freeze(['single_function_call','single_json_document']);
export function strictDocument(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw new Error('JSON_SIZE_OR_TYPE');
 let body=text.trim();
 if(body.startsWith('```')){
  const m=body.match(/^```json[ \t]*\r?\n([\s\S]*)\r?\n```$/i);
  if(!m)throw new Error('INVALID_JSON_FENCE');body=m[1];
 }
 let value;try{value=JSON.parse(body);}catch{throw new Error('EXACTLY_ONE_JSON_DOCUMENT_REQUIRED');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON_OBJECT_REQUIRED');
 // JSON.parse alone silently accepts duplicate object keys. Reject them,
 // including escaped aliases, before schema validation can hide an overwritten key.
 let i=0;const ws=()=>{while(/\s/.test(body[i]??'')&&i<body.length)i++;};
 function string(){const start=i++;while(i<body.length){if(body[i]==='\\'){i+=2;continue;}if(body[i++]==='"')return JSON.parse(body.slice(start,i));}throw new Error('INVALID_JSON_STRING');}
 function walk(depth){if(depth>32)throw new Error('JSON_DEPTH_LIMIT');ws();
  if(body[i]==='{'){i++;ws();const keys=new Set();if(body[i]==='}'){i++;return;}while(true){ws();const key=string();if(keys.has(key))throw new Error('DUPLICATE_JSON_KEY');keys.add(key);ws();i++;walk(depth+1);ws();if(body[i++]==='}')return;}}
  else if(body[i]==='['){i++;ws();if(body[i]===']'){i++;return;}while(true){walk(depth+1);ws();if(body[i++ ]===']')return;}}
  else if(body[i]==='"')string();
  else {const m=body.slice(i).match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)throw new Error('INVALID_JSON_VALUE');i+=m[0].length;}
 }
 walk(0);return value;
}
export function decodeEnvelope(raw,{allowed=ENVELOPES}={}){
 if(!Array.isArray(raw?.choices)||raw.choices.length!==1)throw new Error('ONE_CHOICE_REQUIRED');
 const choice=raw.choices[0],message=choice.message;
 if(message?.role!=='assistant'||message.refusal)throw new Error('ASSISTANT_RESPONSE_REQUIRED');
 const calls=message.tool_calls;
 if(calls!==undefined&&calls!==null&&!Array.isArray(calls))throw new Error('INVALID_TOOL_CALLS');
 if(calls?.length){
  if(!allowed.includes('single_function_call')||choice.finish_reason!=='tool_calls'||calls.length!==1||calls[0].type!=='function'||calls[0].function?.name!=='interpret_care'||(message.content!=null&&String(message.content).trim()!==''))throw new Error('INVALID_FUNCTION_ENVELOPE');
  // Tool arguments must be JSON, not Markdown.
  if(typeof calls[0].function.arguments!=='string'||calls[0].function.arguments.trim().startsWith('```'))throw new Error('INVALID_FUNCTION_ARGUMENTS');
  return {envelope:'single_function_call',value:strictDocument(calls[0].function.arguments)};
 }
 if(!allowed.includes('single_json_document')||choice.finish_reason!=='stop')throw new Error('INVALID_TEXT_ENVELOPE');
 return {envelope:'single_json_document',value:strictDocument(message.content)};
}
