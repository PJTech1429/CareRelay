// Independently authored, synthetic Chat Completions fixtures. No model was
// called to obtain these. Lookup is only available to offline tests/runner.
const E=quote=>({quote});
const action=(action,quote,ownership,temporal,candidates,timeText)=>({action,evidence:E(quote),ownership,temporal,candidates,timeText});
const update=extras=>({version:2,boundary:'coordination',intent:'update',people:[],facts:[],responsibilities:[],shifts:[],review:[],...extras});
export const authored={
 S1:update({
  people:[{mention:'I',evidence:E('I can re-cover the garden cushions on Friday if that would help.')},{mention:'My',evidence:E('My shift ends at 5 PM.')}],
  facts:[{evidence:E('The spare blankets are in the blue cabinet.')}],
  responsibilities:[action('re-cover the garden cushions','I can re-cover the garden cushions on Friday if that would help.','offered','pending',['I'],'Friday')],
  shifts:[{caregiverText:'My',startsAt:null,endsAt:'5 PM',evidence:E('My shift ends at 5 PM.')}]}),
 S2:update({
  people:[{mention:'I',evidence:E('I will take the framed photos to the repair shop on Tuesday.')},{mention:'Jules',evidence:E('Jules has already collected the repaired lamp.')}],
  responsibilities:[action('take the framed photos to the repair shop','I will take the framed photos to the repair shop on Tuesday.','reported_commitment','pending',['I'],'Tuesday'),action('collect the repaired lamp','Jules has already collected the repaired lamp.','reported_commitment','reported_complete',['Jules'],null)],
  shifts:[{caregiverText:'Jules',startsAt:'6 PM',endsAt:'9 PM',evidence:E('Jules is covering 6 PM to 9 PM.')}]}),
 S3:update({
  people:[{mention:'Lena',evidence:E('Either Lena or Omar may bring the folding chairs tomorrow; neither has agreed yet.')},{mention:'Omar',evidence:E('Either Lena or Omar may bring the folding chairs tomorrow; neither has agreed yet.')}],
  responsibilities:[action('bring the folding chairs','Either Lena or Omar may bring the folding chairs tomorrow; neither has agreed yet.','ambiguous','pending',['Lena','Omar'],'tomorrow'),action('sweep the front step','The front step still needs sweeping.','missing','pending',[],null)]}),
 C1:{version:2,boundary:'coordination',intent:'clarification',proposalId:'$pending',ownerText:'Lena',actionText:null,decision:'resolve',evidence:E('Lena will bring the folding chairs tomorrow.')},
 C2:{version:2,boundary:'coordination',intent:'correction',targetIds:['$selected'],operation:'replace_owner',ownerText:'Jules',actionText:null,evidence:E('Correction: Jules will take the framed photos to the repair shop on Tuesday.')}
};
export function fixtureResponse(caseId,request){
 if(!Object.hasOwn(authored,caseId))throw new Error('NO_OFFLINE_FIXTURE');
 const p=JSON.parse(request.messages[1].content),m=p.originalMessages.at(-1);
 function bind(x){
  if(x==='$pending')return p.pending.id;if(x==='$selected')return p.selectedTaskId;
  if(Array.isArray(x))return x.map(bind);
  if(x&&typeof x==='object'){
   if(Object.keys(x).length===1&&Object.hasOwn(x,'quote')){const start=m.text.indexOf(x.quote);if(start<0)throw new Error('FIXTURE_NOT_IN_MESSAGE');return {messageId:m.id,start,end:start+x.quote.length,quote:x.quote};}
   return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,bind(v)]));
  }return x;
 }
 return {raw:{id:'chatcmpl-OFFLINE-'+caseId,object:'chat.completion',created:1792152000,model:request.model,
  choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'call-OFFLINE-'+caseId,type:'function',function:{name:'interpret_care',arguments:JSON.stringify(bind(authored[caseId]))}}]},finish_reason:'tool_calls'}],
  usage:{prompt_tokens:1900,completion_tokens:650,total_tokens:2550}},service:{httpStatus:200,synthetic:true}};
}
