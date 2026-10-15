import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { z } from 'zod';
import { Engine, admin } from './core/engine.js';
import { Store } from './core/store.js';
import { constantEqual, hash, token, type Vault } from './core/security.js';
import { createPlatformVault } from './core/linux-vault.js';
import { browserDefaults, publicOrigin, type BrowserChannel } from './core/platform.js';
import { OAuth } from './core/oauth.js';
import { acquireLock } from './core/lock.js';
import { officialActions, officialExecutor } from './connectors/official.js';
import { kmaAction, kmaExecutor } from './connectors/kma.js';
import { airkoreaAction, airkoreaExecutor } from './connectors/airkorea.js';
import { tagoActions, tagoExecutor } from './connectors/tago.js';
import { egenAction, egenExecutor } from './connectors/egen.js';
import { neisActions, neisExecutor } from './connectors/neis.js';
import { kobisAction, kobisExecutor } from './connectors/kobis.js';
import { BrowserRunner, browserActions } from './connectors/browser.js';
import { RemoteRegistry } from './connectors/remote.js';
import { registerReviewedExtensions } from './connectors/extensions.js';
import { LifestyleConnections } from './connectors/lifestyle/index.js';
import { gangnamunniHospitalAction, gangnamunniReadPlanExecutor } from './connectors/lifestyle/gangnamunni-read.js';
import { daangnItemAction, daangnReadPlanExecutor } from './connectors/lifestyle/daangn-read.js';
import { draftActions, draftExecutor, draftExample, previewDraftRequest } from './connectors/drafts/index.js';
import { appApiBacklog } from './research/app-api-backlog.js';
import { services } from './catalog.js';
import { ActionError, type Evidence, type Principal } from './types.js';
import { DeepSeekCredentials } from './ai/credentials.js';
import { Conversations } from './ai/conversations.js';

export interface RuntimeOptions {dataDir:string;port?:number;vault?:Vault;masterKeyFile?:string;fetcher?:typeof fetch;aiFetcher?:typeof fetch;publicUrl?:string;bootstrapCode?:string;headless?:boolean;channel?:BrowserChannel;dev?:boolean;uiDir?:string;evidenceMode?:'live'|'mock'}
const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const page=(title:string,body:string)=>`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:24px;background:#f5f7f3;color:#183126}label{display:block;margin:16px 0}input,textarea,button{font:inherit;padding:12px;border:1px solid #bbc9bc;border-radius:8px}input,textarea{display:block;width:90%;margin-top:8px}button{background:#245840;color:white;cursor:pointer}article{padding:16px;background:white;border-radius:12px;margin:12px 0;white-space:pre-wrap}a{color:#245840}</style></head><body>${body}</body></html>`;

export async function createRuntime(options:RuntimeOptions){
  publicOrigin(options.publicUrl);
  const unlock=acquireLock(options.dataDir);
  try{const runtime=await createUnlockedRuntime(options);return {...runtime,close:async()=>{try{await runtime.close();}finally{unlock();}}};}
  catch(error){unlock();throw error;}
}
async function createUnlockedRuntime(options:RuntimeOptions){
  const store=new Store(join(options.dataDir,'koreai.sqlite'));
  let vault:Vault;
  let engine:Engine;let browser:BrowserRunner;let connections:LifestyleConnections;
  try{vault=options.vault??createPlatformVault(options.dataDir,options.masterKeyFile??process.env.KOREAI_MASTER_KEY_FILE,{allowCreate:!existsSync(join(options.dataDir,'deepseek.secret.json'))});engine=new Engine(store,vault,options.evidenceMode??'live');
    engine.register(officialActions,officialExecutor(options.fetcher));
    engine.register([kmaAction],kmaExecutor(options.fetcher));
    engine.register([airkoreaAction],airkoreaExecutor(options.fetcher));
    engine.register(tagoActions,tagoExecutor(options.fetcher));
    engine.register([egenAction],egenExecutor(options.fetcher));
    engine.register(neisActions,neisExecutor(options.fetcher));
    engine.register([kobisAction],kobisExecutor(options.fetcher));
    const defaults=browserDefaults();
    browser=new BrowserRunner(options.dataDir,options.channel??defaults.channel,options.headless??defaults.headless);engine.register(browserActions,browser.execute);
    connections=new LifestyleConnections(store);engine.register(connections.actions,connections.execute);
    engine.register([gangnamunniHospitalAction],gangnamunniReadPlanExecutor);
    engine.register([daangnItemAction],daangnReadPlanExecutor);
    engine.register(draftActions,draftExecutor);
    registerReviewedExtensions(engine);
  }catch(error){store.close();throw error;}
  const remote=new RemoteRegistry(engine);const oauth=new OAuth(engine,options.fetcher);
  const app=express();app.disable('x-powered-by');
  const bootstrapCode=options.bootstrapCode??token();let bootstrapUsed=false;
  const sessionAge=30*24*60*60*1000;let failedBootstrap=0;let attemptWindow=Date.now();
  let baseUrl='';let server:Server;
  const publicUrl=publicOrigin(options.publicUrl);
  const chats=new Conversations(engine,store,vault!,new DeepSeekCredentials(options.dataDir,vault!),()=>baseUrl,options.aiFetcher);
  const origins=()=>[baseUrl,...(publicUrl?[publicUrl]:[]),...(options.dev?['http://127.0.0.1:5173']:[])];
  const principal=(res:Response)=>res.locals.principal as Principal;
  app.use((req,res,next)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).end();return;}
    if(!origins().some(o=>new URL(o).host===req.headers.host)){res.status(403).json({error:{code:'INVALID_HOST',message:'로컬 주소로 접속하세요.'}});return;}
    if(req.headers.origin&&!origins().includes(req.headers.origin)){res.status(403).json({error:{code:'INVALID_ORIGIN',message:'허용되지 않은 웹 출처입니다.'}});return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy',req.path.startsWith('/demo')?'same-origin':'no-referrer');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'${options.dev?" 'unsafe-inline'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${options.dev?' ws://127.0.0.1:5173':''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    next();
  });
  app.use(express.json({limit:'256kb'}));
  app.get('/api/health',(_req,res)=>res.json({name:'KoreAI',version:'0.1.0-alpha.1',storage:'sqlite',platform:process.platform}));
  app.post('/api/bootstrap',(req,res)=>{
    if(!req.headers.origin||!origins().includes(req.headers.origin)){res.status(403).json({error:{code:'ORIGIN_REQUIRED',message:'관리 화면에서 로그인하세요.'}});return;}
    if(Date.now()-attemptWindow>60_000){failedBootstrap=0;attemptWindow=Date.now();}
    if(failedBootstrap>=10){res.status(429).json({error:{code:'RATE_LIMIT',message:'잠시 후 다시 시도하세요.'}});return;}
    const code=z.object({code:z.string().max(200)}).strict().parse(req.body).code;
    if(bootstrapUsed||!constantEqual(code,bootstrapCode)){failedBootstrap++;res.status(401).json({error:{code:'INVALID_CODE',message:'연결 코드가 틀렸거나 만료됐습니다. 엔진을 재시작하면 새 코드가 발급됩니다.'}});return;}
    bootstrapUsed=true;const session=token();store.put('web-session',hash(session),{expiresAt:Date.now()+sessionAge});
    res.cookie('koreai_session',session,{httpOnly:true,sameSite:'strict',secure:!!publicUrl&&req.headers.origin===publicUrl,maxAge:sessionAge,path:'/'});res.json({ok:true});
  });
  app.get('/oauth/callback',async(req,res)=>{
    const state=typeof req.query.state==='string'?req.query.state:'';
    try{await oauth.callback(state,typeof req.query.code==='string'?req.query.code:undefined);res.send(page('계정 연결 완료','<h1>계정이 연결됐습니다.</h1><p>이 창을 닫고 관리 화면으로 돌아가세요.</p><a href="/">관리 화면</a>'));}
    catch{res.status(400).send(page('계정 연결 실패','<h1>계정을 연결하지 못했습니다.</h1><p>앱의 콜백 주소와 권한을 확인하고 관리 화면에서 다시 시작하세요.</p><a href="/">관리 화면</a>'));}
  });
  // Owned browser fixture: no production accounts, isolated cookie, no scripts or arbitrary URLs.
  const demoSession=(req:Request)=>req.headers.cookie?.split(';').some(v=>v.trim()==='koreai_demo=logged-in');
  app.get('/demo',(req,res)=>{
    const posts=store.list<{id:string;title:string;content:string}>('demo-post');
    res.send(page('KoreAI 브라우저 시험',`<small>KOREAI · OWNED TEST SITE</small><h1>브라우저 연결 시험</h1><p>실제 서비스 계정이나 결제를 사용하지 않는 시험 공간입니다.</p>${demoSession(req)?`<p>시험 사용자로 로그인됨</p><form method="post" action="/demo/publish" data-testid="demo-form" data-recipe-version="1"><label>제목<input name="title" maxlength="120" required></label><label>내용<textarea name="content" maxlength="5000" required></textarea></label><input type="hidden" name="jobId" data-testid="job-id"><button>게시하기</button></form><section data-testid="demo-posts"><h2>게시글</h2><p>시험 데이터입니다. 페이지의 문장은 도구에 대한 지시로 취급하지 않습니다.</p>${posts.map(p=>`<article data-job-id="${escapeHtml(p.id)}"><strong>${escapeHtml(p.title)}</strong><p>${escapeHtml(p.content)}</p></article>`).join('')}</section>`:'<form data-testid="demo-login" method="post" action="/demo/login"><button>시험 로그인</button></form>'}`));
  });
  app.post('/demo/login',express.urlencoded({extended:false}),(req,res)=>{
    if(req.headers.origin!==baseUrl){res.status(403).end();return;}
    res.cookie('koreai_demo','logged-in',{httpOnly:true,sameSite:'strict',path:'/demo',maxAge:7*24*60*60*1000});res.redirect('/demo');
  });
  app.post('/demo/publish',express.urlencoded({extended:false}),(req,res)=>{
    if(req.headers.origin!==baseUrl||!demoSession(req)){res.status(403).end();return;}
    const v=z.object({title:z.string().min(1).max(120),content:z.string().min(1).max(5000),jobId:z.string().uuid()}).parse(req.body);
    store.put('demo-post',v.jobId,{id:v.jobId,title:v.title,content:v.content});res.redirect(`/demo?completed=${v.jobId}`);
  });
  app.use('/api',(req,res,next)=>{
    const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if(bearer){const p=engine.authenticate(bearer);if(p){res.locals.principal=p;next();return;}}
    else {
      const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('koreai_session='))?.slice('koreai_session='.length);
      if(cookie&&(store.get<{expiresAt:number}>('web-session',hash(cookie))?.expiresAt??0)>Date.now()){
        if(!['GET','HEAD'].includes(req.method)&&(!req.headers.origin||!origins().includes(req.headers.origin))){res.status(403).json({error:{code:'ORIGIN_REQUIRED',message:'관리 화면에서 실행하세요.'}});return;}
        res.locals.principal=admin;next();return;
      }
    }
    res.status(401).json({error:{code:'UNAUTHORIZED',message:'엔진 연결 코드 또는 클라이언트 인증이 필요합니다.'}});
  });
  const onlyAdmin=(_req:Request,res:Response,next:NextFunction)=>{if(principal(res).role!=='admin'){res.status(403).json({error:{code:'FORBIDDEN',message:'관리 화면에서만 가능한 작업입니다.'}});return;}next();};
  app.get('/api/session',(_req,res)=>res.json({principal:principal(res)}));
  app.post('/api/logout',onlyAdmin,(req,res)=>{const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('koreai_session='))?.slice(15);if(cookie)store.delete('web-session',hash(cookie));res.clearCookie('koreai_session',{path:'/',httpOnly:true,sameSite:'strict',secure:!!publicUrl&&req.headers.origin===publicUrl});res.json({ok:true});});
  app.get('/api/ai',onlyAdmin,(_req,res)=>res.json(chats.settings()));
  app.post('/api/ai/key',onlyAdmin,async(req,res)=>res.json(await chats.saveKey(req.body)));
  app.get('/api/chats',onlyAdmin,(_req,res)=>res.json(chats.list()));
  app.post('/api/chats',onlyAdmin,async(req,res)=>res.status(201).json(await chats.create(req.body)));
  app.get('/api/chats/:id',onlyAdmin,(req,res)=>res.json(chats.get(String(req.params.id))));
  app.post('/api/chats/:id/messages',onlyAdmin,(req,res)=>res.status(202).json(chats.submit(String(req.params.id),req.body)));
  app.get('/api/actions',(req,res)=>res.json(engine.discover(principal(res),typeof req.query.q==='string'?req.query.q:'',typeof req.query.service==='string'?req.query.service:undefined)));
  app.get('/api/backlog',onlyAdmin,(_req,res)=>res.json(appApiBacklog));
  app.get('/api/drafts/:id/example',onlyAdmin,(req,res)=>{
    const example=draftExample(String(req.params.id));if(!example)throw new ActionError('NOT_FOUND','연결 초안을 찾을 수 없습니다.');res.json(example);
  });
  app.post('/api/drafts/:id/preview',onlyAdmin,(req,res)=>res.json(previewDraftRequest(String(req.params.id),req.body)));
  app.get('/api/actions/:id',(req,res)=>{const action=engine.discover(principal(res)).find(a=>a.id===req.params.id);if(!action)throw new ActionError('NOT_FOUND','행동을 찾을 수 없습니다.');res.json(action);});
  app.get('/api/accounts',(_req,res)=>res.json(engine.accounts(principal(res))));
  app.get('/api/connections',(_req,res)=>{
    const allowed=new Set(engine.discover(principal(res)).map(a=>a.id));
    res.json(connections.list().filter(c=>connections.actions.some(a=>a.serviceId===c.serviceId&&allowed.has(a.id))));
  });
  app.put('/api/connections/:id',onlyAdmin,(req,res)=>res.json(connections.prepare(String(req.params.id),req.body)));
  app.delete('/api/connections/:id',onlyAdmin,(req,res)=>{connections.remove(String(req.params.id));res.json({ok:true});});
  app.get('/api/services',(_req,res)=>res.json(services.map(s=>({...s,research:s.candidateActions.map((title,i)=>({id:`research.${s.id}.${i+1}`,title,implemented:false,verification:'unresearched',method:null,sourceUrl:null,checkedAt:null,requiredSecrets:[],scopes:[],resultCheck:'미조사',maintainer:'미배정'})),actions:engine.discover(principal(res),'',s.id)}))));
  app.get('/api/jobs',(_req,res)=>res.json(engine.jobs(principal(res))));
  app.post('/api/jobs',(req,res)=>res.status(202).json(engine.create(principal(res),req.body)));
  app.get('/api/jobs/:id',(req,res)=>{const job=engine.get(principal(res),String(req.params.id));res.json({...job,...(principal(res).role==='admin'?{approvalDigest:engine.digest(job)}:{})});});
  app.post('/api/jobs/:id/cancel',async(req,res)=>res.json(await engine.cancel(principal(res),String(req.params.id))));
  app.post('/api/jobs/:id/resume',(req,res)=>res.json(engine.resume(principal(res),String(req.params.id))));
  app.patch('/api/jobs/:id',onlyAdmin,(req,res)=>{const v=z.object({input:z.record(z.unknown()),revision:z.number().int()}).strict().parse(req.body);res.json(engine.edit(principal(res),String(req.params.id),v.input,v.revision));});
  app.post('/api/jobs/:id/approve',onlyAdmin,(req,res)=>{const v=z.object({revision:z.number().int(),digest:z.string().length(64)}).strict().parse(req.body);res.json(engine.approve(principal(res),String(req.params.id),v.revision,v.digest));});
  app.post('/api/jobs/:id/resolve',onlyAdmin,(req,res)=>{const v=z.object({outcome:z.enum(['succeeded','failed']),note:z.string().trim().min(1).max(500)}).strict().parse(req.body);res.json(engine.resolve(principal(res),String(req.params.id),v.outcome,v.note));});
  app.post('/api/accounts',onlyAdmin,async(req,res)=>res.status(201).json(await engine.saveAccount(req.body)));
  app.delete('/api/accounts/:id',onlyAdmin,async(req,res)=>{await engine.removeAccount(String(req.params.id));res.json({ok:true});});
  app.post('/api/accounts/:id/refresh',onlyAdmin,async(req,res)=>res.json(await oauth.refresh(String(req.params.id))));
  app.post('/api/oauth/start',onlyAdmin,async(req,res)=>res.json(await oauth.start(req.body)));
  app.get('/api/clients',onlyAdmin,(_req,res)=>res.json(engine.clients()));
  app.post('/api/clients',onlyAdmin,(req,res)=>res.status(201).json(engine.createClient(req.body)));
  app.delete('/api/clients/:id',onlyAdmin,async(req,res)=>{await engine.revokeClient(String(req.params.id));res.json({ok:true});});
  app.post('/api/actions/:id/release',onlyAdmin,(req,res)=>{engine.release(String(req.params.id));res.json({ok:true});});
  app.post('/api/actions/:id/status',onlyAdmin,async(req,res)=>{const v=z.object({suspended:z.boolean()}).strict().parse(req.body);await engine.suspend(String(req.params.id),v.suspended);res.json({ok:true});});
  app.post('/api/browser/open',onlyAdmin,async(_req,res)=>res.json(await browser.open()));
  app.post('/api/browser/demo-login',onlyAdmin,async(_req,res)=>res.json(await browser.loginDemo()));
  app.post('/api/browser/close',onlyAdmin,async(_req,res)=>{await browser.close();res.json({ok:true});});
  app.post('/api/remotes',onlyAdmin,async(req,res)=>res.status(201).json(await remote.add(req.body)));
  app.delete('/api/remotes/:id',onlyAdmin,async(req,res)=>{await remote.remove(String(req.params.id));res.json({ok:true});});
  app.get('/api/state',onlyAdmin,(_req,res)=>res.json({services,backlog:appApiBacklog,ai:chats.settings(),connections:connections.list(),actions:engine.discover(admin),accounts:engine.accounts(),clients:engine.clients(),jobs:engine.jobs().map(j=>({...j,approvalDigest:engine.actions.has(j.actionId)?engine.digest(j):null})),metrics:engine.metrics(),evidence:store.list<Evidence>('evidence').slice(0,200),browser:browser.status(),runtime:{platform:process.platform,vault:options.vault?'custom':process.platform==='win32'?'windows-dpapi':'file-aes-256-gcm'},remotes:remote.list(),oauthRedirectUri:`${publicUrl??baseUrl}/oauth/callback`,defaultTimezone:'Asia/Seoul',mcpConfig:{command:process.execPath,args:[resolve('dist/mcp.js')],env:{KOREAI_URL:baseUrl}}}));
  app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'API를 찾을 수 없습니다.'}}));
  const uiDir=options.uiDir??resolve('web-dist');
  if(existsSync(join(uiDir,'index.html'))){app.use(express.static(uiDir));app.get('/{*path}',(_req,res)=>res.sendFile(join(uiDir,'index.html')));}
  else app.get('/',(_req,res)=>res.send(page('KoreAI','<h1>KoreAI 엔진 실행 중</h1><p>npm run build 후 다시 시작하거나 개발 UI를 실행하세요.</p>')));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(error instanceof z.ZodError){res.status(400).json({error:{code:'INVALID_INPUT',message:error.issues.map(e=>`${e.path.join('.')}: ${e.message}`).join('; ')}});return;}
    if(error instanceof ActionError){res.status(error.code==='NOT_FOUND'?404:error.code==='FORBIDDEN'?403:409).json({error:{code:error.code,message:error.message}});return;}
    res.status(500).json({error:{code:'INTERNAL_ERROR',message:'작업을 처리하지 못했습니다. 연결 설정과 로컬 실행 환경을 확인하세요.'}});
  });
  try{await new Promise<void>((resolveStart,reject)=>{server=app.listen(options.port??4318,'127.0.0.1',()=>resolveStart());server.on('error',reject);});}
  catch(error){await browser.close();store.close();throw error;}
  const address=server!.address();if(!address||typeof address==='string')throw new Error('주소를 확인할 수 없습니다.');
  baseUrl=`http://127.0.0.1:${address.port}`;browser.baseUrl=baseUrl;oauth.baseUrl=publicUrl??baseUrl;
  return {app,server:server!,engine,store,browser,remote,oauth,chats,baseUrl,publicUrl,bootstrapCode,
    close:async()=>{await chats.close();await engine.close();await browser.close();server!.closeAllConnections();await new Promise<void>((resolveClose,reject)=>server!.close(e=>e?reject(e):resolveClose()));store.close();},
  };
}
