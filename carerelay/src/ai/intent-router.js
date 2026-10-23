
import update from './contracts/update.js';
import question from './contracts/question.js';
import correction from './contracts/correction.js';
import clarification from './contracts/clarification.js';
export const contracts={update,question,correction,clarification};
// Conservative local routing, NOT semantic interpretation. The visible intent
// selector can override this heuristic. No route can execute confirmation.
export function routeIntent(text,{intent='auto',pending=null}={}){
 if(intent!=='auto'){if(!contracts[intent])throw new Error('Unknown intent');return intent;}
 if(/^(?:actually\b|correction\b|cancel\b|reassign\b|mark\b|change\b|instead\b)/i.test(text.trim()))return 'correction';
 if(/^(?:what|who|when|where|which|how|has|have|did|is|are)\b/i.test(text.trim())||/\?\s*$/.test(text))return 'question';
 if(pending)return 'clarification';
 return 'update';
}
