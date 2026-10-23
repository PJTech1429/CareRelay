// Capture only AWS CLI service-error explanations, never raw stderr or SSO output.
export function safeServiceDiagnostic(stderr){
 const match=String(stderr).match(/(?:^|\n)An error occurred \(([A-Za-z][A-Za-z0-9]+)\) when calling the ([A-Za-z][A-Za-z0-9]+) operation: ([^\r\n]*)/);
 if(!match)return null;
 let message=match[3].slice(0,8192);
 message=message
  .replace(/(?:Bearer|Basic)\s+[^\s,;]+/gi,'[REDACTED_AUTH]')
  .replace(/(["']?(?:aws_secret_access_key|aws_session_token|aws_access_key_id|accessToken|refreshToken|clientSecret|password|authorization|x-amz-security-token|x-amz-signature)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[REDACTED]')
  .replace(/https?:\/\/[^\s"'<>]+/gi,'[REDACTED_URL]')
  .replace(/arn:aws[^\s"',;]*/g,'[REDACTED_ARN]')
  .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'[REDACTED_ACCESS_KEY]')
  .replace(/\b[A-Za-z0-9_+=/.-]{40,}\b/g,'[REDACTED_OPAQUE_VALUE]')
  .replace(/\b\d{12}\b/g,'[REDACTED_ACCOUNT]')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[REDACTED_EMAIL]')
  .replace(/[A-Za-z]:\\Users\\[^\s"']+/g,'[REDACTED_LOCAL_PATH]');
 return {code:match[1],operation:match[2],message:message.slice(0,2048),truncated:message.length>2048||match[3].length>8192,redacted:true,source:'AWS_CLI_SERVICE_ERROR_FIRST_LINE'};
}
