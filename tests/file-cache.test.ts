import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VerifiedFileCache, fileCacheLimits, type DownloadedFile } from '../src/core/file-cache.js';
import { ActionError } from '../src/types.js';
import { tempDir } from './helpers.js';

const key=(name='file')=>createHash('sha256').update(name).digest('hex');
const file=(value='validated-public-data'):DownloadedFile=>({bytes:Buffer.from(value),providerLastModifiedRaw:null});
const code=(name:string)=>(e:unknown)=>e instanceof ActionError&&e.code===name;
const signal=()=>new AbortController().signal;
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}

test('file cache verifies size/hash, survives restart and retains download time without a new loader or dispatch',async()=>{
  const dir=tempDir('file-cache-restart');let calls=0,dispatches=0;const cache=new VerifiedFileCache(dir);
  const first=await cache.getOrLoad(key(),signal(),async()=>{calls++;return file();},()=>{dispatches++;});assert.equal(first.cache.status,'downloaded');await cache.close();
  const restarted=new VerifiedFileCache(dir);try{await restarted.prepare();const hit=await restarted.getOrLoad(key(),signal(),async()=>{calls++;throw Error('must not download');},()=>{dispatches++;});assert.equal(hit.cache.status,'hit');assert.equal(hit.cache.downloadedAt,first.cache.downloadedAt);assert.equal(hit.cache.expiresAt,first.cache.expiresAt);assert.equal(calls,1);assert.equal(dispatches,1);assert.deepEqual(hit.bytes,first.bytes);}finally{await restarted.close();}
});
test('file cache replaces corrupt bytes and expired entries instead of using stale content',async()=>{
  const dir=tempDir('file-cache-recovery'),cache=new VerifiedFileCache(dir);let calls=0;const load=async()=>{calls++;return file('valid-'+calls);};
  try{
    await cache.getOrLoad(key(),signal(),load,()=>{});await writeFile(join(dir,key()+'.bin'),'broken!');const repaired=await cache.getOrLoad(key(),signal(),load,()=>{});assert.equal(repaired.cache.status,'downloaded');assert.equal(Buffer.from(repaired.bytes).toString(),'valid-2');
    const path=join(dir,key()+'.json'),meta=JSON.parse(await readFile(path,'utf8')),past=Date.now()-fileCacheLimits.ttlMs-1000;meta.downloadedAt=past;meta.expiresAt=past+fileCacheLimits.ttlMs;await writeFile(path,JSON.stringify(meta));const refreshed=await cache.getOrLoad(key(),signal(),load,()=>{});assert.equal(refreshed.cache.status,'downloaded');assert.equal(calls,3);
  }finally{await cache.close();}
});
test('file cache removes interrupted temporary files, orphan bodies and malformed metadata during prepare',async()=>{
  const dir=tempDir('file-cache-orphans');await writeFile(join(dir,'.'+key()+'.'+randomUUID()+'.tmp'),'partial',{mode:0o600});await writeFile(join(dir,key()+'.bin'),'orphan',{mode:0o600});await writeFile(join(dir,key('bad')+'.json'),'{',{mode:0o600});const cache=new VerifiedFileCache(dir);
  try{await cache.prepare();assert.deepEqual(await readdir(dir),[]);await cache.getOrLoad(key(),signal(),async()=>file(),()=>{});assert.equal((await readdir(dir)).length,2);}finally{await cache.close();}
});
test('file cache coalesces concurrent downloads and cancelling one waiter preserves the other',async()=>{
  const dir=tempDir('file-cache-shared'),cache=new VerifiedFileCache(dir),started=deferred<void>(),gate=deferred<DownloadedFile>();let calls=0,dispatches=0;const firstController=new AbortController();
  try{
    const load=async()=>{calls++;started.resolve();return gate.promise;};const first=cache.getOrLoad(key(),firstController.signal,load,()=>{dispatches++;});await started.promise;
    const second=cache.getOrLoad(key(),signal(),load,()=>{dispatches++;});firstController.abort();await assert.rejects(first,code('CANCELLED'));gate.resolve(file());const result=await second;assert.equal(result.cache.status,'shared');assert.equal(calls,1);assert.equal(dispatches,2);
    assert.equal((await cache.getOrLoad(key(),signal(),load,()=>{})).cache.status,'hit');assert.equal(calls,1);
  }finally{gate.resolve(file());await cache.close();}
});
test('file cache aborts a download when every waiter leaves and publishes no partial file',async()=>{
  const dir=tempDir('file-cache-cancel'),cache=new VerifiedFileCache(dir),started=deferred<void>(),controller=new AbortController();let aborted=false;
  const pending=cache.getOrLoad(key(),controller.signal,async shared=>{started.resolve();return new Promise<DownloadedFile>((_resolve,reject)=>{shared.addEventListener('abort',()=>{aborted=true;reject(new ActionError('CANCELLED','cancelled','cancelled'));},{once:true});});},()=>{});
  await started.promise;controller.abort();await assert.rejects(pending,code('CANCELLED'));await cache.close();assert.equal(aborted,true);assert.deepEqual(await readdir(dir),[]);
});
test('file cache rechecks each waiting job before dispatch and one rejected grant cannot block another',async()=>{
  const cache=new VerifiedFileCache(tempDir('file-cache-grants'));let loads=0;
  try{
    const load=async()=>{loads++;return file();};
    const denied=cache.getOrLoad(key(),signal(),load,()=>{throw new ActionError('NOT_AUTHORIZED','revoked');});
    const allowed=cache.getOrLoad(key(),signal(),load,()=>{});
    await assert.rejects(denied,code('NOT_AUTHORIZED'));assert.equal((await allowed).cache.status,'shared');assert.equal(loads,1);
  }finally{await cache.close();}
});
test('file cache enforces disk and entry budgets by evicting the oldest completed file',async()=>{
  const dir=tempDir('file-cache-budget'),cache=new VerifiedFileCache(dir,{maxBytes:18200,maxEntryBytes:10000,maxEntries:3});let calls=0;
  try{
    for(const name of ['a','b'])await cache.getOrLoad(key(name),signal(),async()=>{calls++;return{...file(),bytes:Buffer.alloc(9000,1)};},()=>{});
    const names=await readdir(dir),total=(await Promise.all(names.map(n=>stat(join(dir,n))))).reduce((sum,s)=>sum+s.size,0);assert(total<=18200);assert(!names.includes(key('a')+'.bin'));assert(names.includes(key('b')+'.bin'));
    await cache.getOrLoad(key('a'),signal(),async()=>{calls++;return file();},()=>{});assert.equal(calls,3);
  }finally{await cache.close();}
});
test('file cache keeps failed validation/load results out of storage and rejects path traversal keys',async()=>{
  const dir=tempDir('file-cache-failure'),cache=new VerifiedFileCache(dir);try{
    await assert.rejects(()=>cache.getOrLoad('../outside',signal(),async()=>file(),()=>{}),code('CACHE_UNSAFE_PATH'));
    await assert.rejects(()=>cache.getOrLoad(key(),signal(),async()=>{throw new ActionError('INVALID_RESPONSE','bad');},()=>{}),code('INVALID_RESPONSE'));assert.deepEqual(await readdir(dir),[]);
    const result=await cache.getOrLoad(key(),signal(),async()=>file(),()=>{});assert.equal(result.cache.status,'downloaded');
  }finally{await cache.close();}
});
test('file cache refuses a symlink/junction root and leaves the outside directory untouched',async()=>{
  const base=tempDir('file-cache-symlink'),outside=join(base,'outside'),root=join(base,'link');await mkdir(outside,{mode:0o700});await writeFile(join(outside,'sentinel'),'keep');await symlink(outside,root,process.platform==='win32'?'junction':'dir');const cache=new VerifiedFileCache(root);
  try{await assert.rejects(()=>cache.prepare(),code('CACHE_UNSAFE_PATH'));assert.equal(await readFile(join(outside,'sentinel'),'utf8'),'keep');assert.deepEqual(await readdir(outside),['sentinel']);}finally{await cache.close();}
});
test('Linux file cache rejects unsafe modes and symlink entries without touching their targets',{skip:process.platform==='win32'},async()=>{
  const dir=tempDir('file-cache-posix'),cache=new VerifiedFileCache(dir);await chmod(dir,0o755);await assert.rejects(()=>cache.prepare(),code('CACHE_UNSAFE_PATH'));await chmod(dir,0o700);
  const outside=tempDir('file-cache-outside'),target=join(outside,'keep');await writeFile(target,'keep',{mode:0o600});await symlink(target,join(dir,key()+'.bin'));await assert.rejects(()=>cache.prepare(),code('CACHE_UNSAFE_PATH'));assert.equal(await readFile(target,'utf8'),'keep');await cache.close();
});
