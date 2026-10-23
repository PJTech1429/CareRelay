import {mkdir,open,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {JsonStore} from '../store.js';
const waits=[25,50,100,200,400,800,1000];
// Local filesystem recovery only. Never replays a transaction, provider call,
// confirmation or model request. Never deletes the last committed destination.
export async function atomicWriteFile(file,text,{platform=process.platform,renameImpl=rename,wait=delay}={}){
 await mkdir(path.dirname(file),{recursive:true});
 const temporary=`${file}.${process.pid}.${randomUUID()}.tmp`;
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}
 for(let attempt=0;;attempt++){
  try{await renameImpl(temporary,file);return {renameAttempts:attempt+1};}
  catch(error){
   if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=waits.length)throw error;
   await wait(waits[attempt]);
  }
 }
}
export async function writeJson(file,value){return atomicWriteFile(file,JSON.stringify(value,null,2)+'\n');}
export class WindowsJsonStore extends JsonStore{
 constructor(file,options={}){super(file);this.fileOptions=options;}
 async save(state){await atomicWriteFile(this.filePath,JSON.stringify(state,null,2)+'\n',this.fileOptions);}
}
