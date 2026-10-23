import {spawn} from 'node:child_process';
import {safeServiceDiagnostic} from './error-diagnostics.js';
export const OPERATIONS=new Set(['sts:get-caller-identity','bedrock:get-foundation-model-availability','bedrock:get-inference-profile','bedrock-runtime:converse']);
const endpoints={sts:'https://sts.us-east-1.amazonaws.com',bedrock:'https://bedrock.us-east-1.amazonaws.com','bedrock-runtime':'https://bedrock-runtime.us-east-1.amazonaws.com'};
export function cleanEnvironment(source=process.env){const env={...source};for(const k of Object.keys(env))if(/^AWS_/i.test(k))delete env[k];Object.assign(env,{AWS_MAX_ATTEMPTS:'1',AWS_RETRY_MODE:'standard',AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off',AWS_EC2_METADATA_DISABLED:'true'});return env;}
export function sanitizedError(text){return ['AccessDeniedException','ExpiredToken','ValidationException','ThrottlingException','ResourceNotFoundException'].find(k=>text.includes(k))??(/SSO|sso|token has expired/i.test(text)?'SSO_SESSION_EXPIRED':/Invalid choice|Unknown options/i.test(text)?'CLI_UNSUPPORTED':'AWS_OPERATION_FAILED');}
export function makeCli({log,spawnImpl=spawn}){
 return async function aws(service,operation,args=[],local=false){
  if(!OPERATIONS.has(`${service}:${operation}`))throw new Error('UNAPPROVED_AWS_OPERATION');
  if(local&&!(service==='bedrock-runtime'&&operation==='converse'&&args.join(' ')==='--generate-cli-skeleton input'))throw new Error('INVALID_LOCAL_OPERATION');
  await log({operation:`${service}:${operation}`,localSkeletonOnly:local,timeUTC:new Date().toISOString()});
  const params=[service,operation,...args,'--profile','care-relay','--region','us-east-1','--endpoint-url',endpoints[service],'--output','json','--no-cli-pager','--no-cli-auto-prompt','--no-paginate','--cli-connect-timeout','15','--cli-read-timeout','120'];
  return new Promise((resolve,reject)=>{
   const child=spawnImpl(process.platform==='win32'?'aws.exe':'aws',params,{shell:false,env:cleanEnvironment(),windowsHide:true});let stdout='',stderr='',settled=false;
   const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){const e=new Error(error);e.code=error;e.awsError=safeServiceDiagnostic(stderr);reject(e);}else resolve(value);};
   const timer=setTimeout(()=>{child.kill();end('TIMEOUT_NO_RETRY');},150000);
   child.stdout.on('data',b=>{stdout+=b;if(stdout.length>3e6){child.kill();end('RESPONSE_TOO_LARGE');}});
   child.stderr.on('data',b=>{if(stderr.length<20000)stderr+=b;});
   child.on('error',()=>end('AWS_CLI_MISSING'));
   child.on('close',code=>{if(code!==0)return end(sanitizedError(stderr));try{end(null,JSON.parse(stdout));}catch{end('INVALID_CLI_JSON');}});
  });
 };
}
// Interactive renewal of the existing profile only. No configure, subscription,
// permission or payment APIs. Device/browser codes stay in the local terminal;
// they are never captured in evidence or the shareable results bundle.
export async function loginExistingSso({spawnImpl=spawn}={}){
 return new Promise((resolve,reject)=>{const child=spawnImpl(process.platform==='win32'?'aws.exe':'aws',['sso','login','--profile','care-relay','--no-cli-auto-prompt'],{shell:false,env:cleanEnvironment(),stdio:'inherit'});const timer=setTimeout(()=>{child.kill();reject(new Error('SSO_LOGIN_TIMEOUT'));},300000);child.on('error',()=>{clearTimeout(timer);reject(new Error('AWS_CLI_MISSING'));});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('SSO_SIGN_IN_NOT_COMPLETED'));});});
}
