
import {obj,arr,str,nullable,evidence,common,responsibility} from './shared.js';
export default obj({...common,intent:{const:'update'},people:arr(obj({mention:str,evidence})),facts:arr(obj({evidence})),responsibilities:arr(responsibility),shifts:arr(obj({caregiverText:str,startsAt:nullable,endsAt:nullable,evidence})),review:arr(obj({evidence,reason:str}))});
