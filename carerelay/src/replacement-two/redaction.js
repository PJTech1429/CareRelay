import {redactServiceText} from '../chat-recovery/transport.js';
// Redact values BEFORE serialization. Never modify JSON syntax or numeric tokens.
const sensitive=/^(?:accesskeyid|secretaccesskey|sessiontoken|authorization|x-amz-security-token|account|accountid|awsaccountid)$/i;
export function redactEvidence(value, credentials={}) {
 if(typeof value==='string')return redactServiceText(value,credentials);
 if(Array.isArray(value))return value.map(v=>redactEvidence(v,credentials));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redactEvidence(v,credentials)]));
 return value;
}
