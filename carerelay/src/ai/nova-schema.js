// Transport-only projection to Nova's documented tool-schema subset.
// Local validation still applies the original contract, including every limit.
export function novaToolSchema(schema) {
 if (schema.anyOf) {
  const members=schema.anyOf;
  if(members.length!==2||members[0].type!=='string'||members[1].type!=='null')throw new Error('UNSUPPORTED_SCHEMA_UNION');
  return {type:['string','null']};
 }
 if(Object.hasOwn(schema,'const'))return {type:typeof schema.const==='number'?'integer':typeof schema.const,enum:[schema.const]};
 const result={type:schema.type};
 if(schema.enum)result.enum=[...schema.enum];
 if(schema.properties){result.properties=Object.fromEntries(Object.entries(schema.properties).map(([k,v])=>[k,novaToolSchema(v)]));result.required=[...schema.required];}
 if(schema.items)result.items=novaToolSchema(schema.items);
 return result;
}
