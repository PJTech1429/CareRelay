
import {obj,common,str,nullable,en,evidence} from './shared.js';
export default obj({...common,intent:{const:'clarification'},proposalId:str,ownerText:nullable,actionText:nullable,decision:en('resolve','uncertain'),evidence});
