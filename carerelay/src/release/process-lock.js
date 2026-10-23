import {open,readFile,rename,unlink} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;if(e.code==='EPERM')return true;throw e;}};
export async function acquireProcessLock(file,{isAlive=alive,pid=process.pid}={}){
 async function create(){const handle=await open(file,'wx',0o600),record={pid,token:randomUUID()};await handle.writeFile(JSON.stringify(record));await handle.sync();return {close:async()=>{await handle.close();try{const current=JSON.parse(await readFile(file));if(current.token===record.token)await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}};}
 try{return await create();}catch(e){if(e.code!=='EEXIST')throw e;}
 const old=JSON.parse(await readFile(file));if(!Number.isInteger(old.pid)||old.pid<1||isAlive(old.pid))throw new Error('HOUSEHOLD_ALREADY_OPEN: another local process owns this data. Close that CareRelay window first.');
 const recovery=file+'.recovery';let guard;try{guard=await open(recovery,'wx',0o600);const current=JSON.parse(await readFile(file));if(current.token!==old.token||isAlive(current.pid))throw new Error('HOUSEHOLD_LOCK_CHANGED');await rename(file,file+'.stale-'+Date.now());return await create();}finally{if(guard){await guard.close();await unlink(recovery);}}
}
