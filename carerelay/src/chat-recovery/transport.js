import {createHash,createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {cleanEnvironment} from '../live/cli-transport.js';
import {ENDPOINT,KIMI_MODEL} from './adapter.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const mac=(key,x)=>createHmac('sha256',key).update(x).digest();
const fail=code=>Object.assign(new Error(code),{code});
export function validateCredentials(c,now=Date.now()){
 if(!/^ASIA[A-Z0-9]{16}$/.test(c?.AccessKeyId??'')||typeof c.SecretAccessKey!=='string'||!c.SecretAccessKey||typeof c.SessionToken!=='string'||!c.SessionToken||!Number.isFinite(Date.parse(c.Expiration))||Date.parse(c.Expiration)-now<120000)throw fail('TEMPORARY_SSO_CREDENTIALS_REQUIRED');
 return c;
}
export async function exportSsoCredentials({spawnImpl=spawn}={}){
 // stdout contains secrets: keep in memory, never log, serialize or include in errors.
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(process.platform==='win32'?'aws.exe':'aws',['configure','export-credentials','--profile','care-relay','--format','process'],{shell:false,env:cleanEnvironment(),windowsHide:true});
  let output='',settled=false;
  const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);output='';error?reject(fail(error)):resolve(value);};
  const timer=setTimeout(()=>{child.kill();end('SSO_CREDENTIAL_EXPORT_TIMEOUT');},30000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>32000){child.kill();end('SSO_CREDENTIAL_EXPORT_SIZE');}});
  child.stderr.on('data',()=>{}); // Never capture credential-process diagnostics.
  child.on('error',()=>end('AWS_CLI_MISSING'));
  child.on('close',code=>{if(code!==0)return end('SSO_CREDENTIAL_EXPORT_FAILED');try{end(null,validateCredentials(JSON.parse(output)));}catch{end('TEMPORARY_SSO_CREDENTIALS_REQUIRED');}});
 });
}
export function signRequest(body,credentials,now=new Date()){
 validateCredentials(credentials,now.getTime());
 const url=new URL(ENDPOINT),date=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),scope=`${day}/us-east-1/bedrock/aws4_request`;
 const headers={'content-type':'application/json',host:url.host,'x-amz-content-sha256':hash(body),'x-amz-date':date,'x-amz-security-token':credentials.SessionToken};
 const names=Object.keys(headers).sort(),canonicalHeaders=names.map(k=>`${k}:${headers[k].trim().replace(/\s+/g,' ')}\n`).join(''),signed=names.join(';');
 const canonical=['POST',url.pathname,'',canonicalHeaders,signed,hash(body)].join('\n');
 const key=mac(mac(mac(mac('AWS4'+credentials.SecretAccessKey,day),'us-east-1'),'bedrock'),'aws4_request');
 const signature=mac(key,['AWS4-HMAC-SHA256',date,scope,hash(canonical)].join('\n')).toString('hex');
 headers.authorization=`AWS4-HMAC-SHA256 Credential=${credentials.AccessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
 return headers;
}
export function redactServiceText(text,credentials={}){
 let out=String(text);
 for(const key of ['AccessKeyId','SecretAccessKey','SessionToken'])if(credentials[key])out=out.split(credentials[key]).join('[REDACTED_CREDENTIAL]');
 return out.replace(/\b(?:ASIA|AKIA)[A-Z0-9]{16}\b/g,'[REDACTED_ACCESS_KEY]')
  .replace(/(Authorization\s*[:=]\s*)([^\r\n]+)/gi,'$1[REDACTED_AUTHORIZATION]')
  .replace(/((?:x-amz-security-token|SecretAccessKey|SessionToken)\s*["']?\s*[:=]\s*["']?)[^"'\s,}\r\n]+/gi,'$1[REDACTED_TOKEN]')
  .replace(/arn:aws[^\s"',;]*/g,'[REDACTED_ARN]')
  .replace(/(?:Bearer|Basic)\s+[^\s"',;]+/gi,'[REDACTED_AUTH]')
  .replace(/\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}\b/g,'[REDACTED_EMAIL]')
  .replace(/[A-Za-z]:\\Users\\[^\s"']+/g,'[REDACTED_LOCAL_PATH]')
  .replace(/(?<![a-f0-9-])\d{12}(?![a-f0-9-])/gi,'[REDACTED_ACCOUNT]');
}
export function makeChatTransport({credentials,fetchImpl=fetch,now=()=>new Date()}){
 return async request=>{
  if(request.model!==KIMI_MODEL||request.max_tokens!==1600||request.tool_choice!=='auto'||request.service_tier!==undefined||request.stream!==undefined)throw fail('UNAPPROVED_CHAT_REQUEST');
  const body=JSON.stringify(request);if(Buffer.byteLength(body)>6500)throw fail('REQUEST_BYTE_LIMIT');
  const headers=signRequest(body,credentials,now());
  let response;try{response=await fetchImpl(ENDPOINT,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(120000)});}catch{throw fail('CHAT_TRANSPORT_FAILURE_NO_RETRY');}
  const safeHeaders={};for(const name of ['content-type','x-amzn-requestid','x-amzn-request-id','x-request-id','x-amzn-errortype','retry-after']){const value=response.headers.get(name);if(value)safeHeaders[name]=redactServiceText(value,credentials);}
  const service={httpStatus:response.status,headers:safeHeaders,bodyRedacted:'',bodyTruncated:false};
  const reader=response.body?.getReader();let size=0,chunks=[];
  try{
   if(!reader)throw fail('EMPTY_SERVICE_RESPONSE');
   while(true){const {value,done}=await reader.read();if(done)break;const remaining=262144-size;chunks.push(Buffer.from(value).subarray(0,Math.max(0,remaining)));size+=value.byteLength;if(size>262144){service.bodyTruncated=true;await reader.cancel();break;}}
   const text=Buffer.concat(chunks).toString('utf8');service.bodyRedacted=redactServiceText(text,credentials);
   if(service.bodyTruncated)throw fail('SERVICE_RESPONSE_SIZE_LIMIT');
   if(!response.ok)throw fail('CHAT_API_REJECTED');
   let raw;try{raw=JSON.parse(service.bodyRedacted);}catch{throw fail('MALFORMED_CHAT_RESPONSE');}
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw fail('MALFORMED_CHAT_RESPONSE');
   if(raw.error)throw fail('CHAT_API_ERROR_BODY');
   return {raw,service};
  }catch(error){service.bodyRedacted||=redactServiceText(Buffer.concat(chunks).toString('utf8'),credentials);const e=fail(error.code??'CHAT_RESPONSE_READ_FAILURE');e.service=service;throw e;}
 };
}
