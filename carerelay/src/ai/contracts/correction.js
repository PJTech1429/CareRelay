import {obj,common,arr,str,en,nullable,evidence} from './shared.js';
const schema=obj({...common,intent:{const:'correction'},targetIds:arr(str),operation:en('cancel','replace_owner','revise','complete','uncertain'),ownerText:nullable,actionText:nullable,evidence});
// Optional only for immutable historical responses. New responses should supply
// explicit source-grounded timing; null/omission means no timing change.
schema.properties.timeText={...nullable,description:'Exact new schedule phrase from correction evidence; null if unchanged. Never put a timing change only in actionText.'};
export default schema;
