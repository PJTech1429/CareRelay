
export const str={type:'string',minLength:1,maxLength:4000};
export const nullable={anyOf:[str,{type:'null'}]};
export const en=(...values)=>({type:'string',enum:values});
export const arr=items=>({type:'array',maxItems:32,items});
export const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const evidence=obj({messageId:str,start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},quote:str});
export const common={version:{const:2},boundary:en('coordination','medical','instruction_attack')};
export const ownership=en('missing','ambiguous','offered','reported_commitment','uncertain');
export const responsibility=obj({action:str,evidence,temporal:en('pending','reported_complete','negated','uncertain'),ownership,candidates:arr(str),timeText:nullable});
