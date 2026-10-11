import { mkdirSync,lstatSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One engine owns a data directory. Acquire before recovery changes any job state. */
export function acquireLock(dataDir:string):()=>void{
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  if(process.platform!=='win32'){
    const stat=lstatSync(dataDir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0)throw new Error('데이터 폴더는 현재 사용자 소유의 실제 디렉터리여야 하며 권한은 700이어야 합니다. chmod 700으로 설정하세요.');
  }
  const path=join(dataDir,'engine.lock');const marker=randomUUID();
  const write=()=>writeFileSync(path,JSON.stringify({pid:process.pid,marker}),{flag:'wx',mode:0o600});
  try{write();}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    let previous:{pid:number};try{previous=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('데이터 폴더의 실행 잠금 파일을 확인하세요.');}
    let live=true;try{process.kill(previous.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')live=false;}
    if(live)throw new Error('이 데이터 폴더를 사용하는 KoreAI 엔진이 이미 실행 중입니다.');
    unlinkSync(path);write();
  }
  return ()=>{try{const current=JSON.parse(readFileSync(path,'utf8'));if(current.marker===marker)unlinkSync(path);}catch{/* A replaced lock is never removed. */}};
}
