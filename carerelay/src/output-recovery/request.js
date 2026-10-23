import {buildChatRequest,KIMI_MODEL} from '../chat-recovery/adapter.js';
// OFFLINE candidate only. This module cannot authenticate, dispatch or retry.
// Provider docs specify low/high/max. Bedrock K3 acceptance remains unverified.
export function buildLowReasoningRequest(context,intent,plan){
 if(plan?.model?.modelId!==KIMI_MODEL||plan.maxOutputTokens!==1600||plan.maxInputTokens!==8000||plan.maxRequestBytes!==6500)throw new Error('UNAPPROVED_OUTPUT_RECOVERY_LIMITS');
 const request={...buildChatRequest(context,intent,plan),reasoning_effort:'low'};
 if(Buffer.byteLength(JSON.stringify(request))>plan.maxRequestBytes)throw new Error('REQUEST_BYTE_LIMIT');
 return request;
}
