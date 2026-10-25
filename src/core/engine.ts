import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { canUse, canonical, constantEqual, hash, redact, token, type Vault } from './security.js';
import { ActionError, assertActionAvailable, type Account, type Action, type ClientRecord, type Evidence, type Executor, type Job, type JobState, type Principal } from '../types.js';

export const requestSchema = z.object({
  actionId:z.string().min(1).max(160), accountId:z.string().uuid().optional(),
  input:z.record(z.unknown()).default({}), idempotencyKey:z.string().min(8).max(160),
  workflowId:z.string().min(1).max(100).optional(), stepName:z.string().max(100).optional(),
}).strict();
export const admin: Principal={id:'local-admin',name:'로컬 관리자',role:'admin',allowedActions:[],allowedAccountIds:[]};
const now=()=>new Date().toISOString();
const terminal=new Set<JobState>(['succeeded','failed','cancelled']);

export class Engine {
  readonly actions=new Map<string,Action>();
  private executors=new Map<string,Executor>();
  private active=new Map<string,AbortController>();
  private tasks=new Set<Promise<void>>();
  private closing=false;
  constructor(readonly store: Store, readonly vault: Vault, readonly evidenceMode: 'live' | 'mock'='live') {
    for(const job of store.allJobs())this.expireResult(job);
    // Crash recovery is conservative: writes may have reached the provider.
    for(const job of store.allJobs()) if(job.state==='running'||job.state==='queued') {
      job.state=job.dispatched&&job.effect==='write'?'needs_review':'awaiting_user';
      job.error={code:'PROCESS_RESTARTED',message:'엔진이 재시작됐습니다. 이전 실행 결과를 확인하세요.'};
      this.save(job,'재시작 후 수동 확인 대기');
    }
  }
  register(actions: Action[], executor: Executor): void { for(const action of actions){this.actions.set(action.id,action);this.executors.set(action.id,executor);} }
  unregister(prefix: string): void { for(const key of this.actions.keys()) if(key.startsWith(prefix)){this.actions.delete(key);this.executors.delete(key);} }
  action(id: string): Action { const action=this.actions.get(id);if(!action)throw new ActionError('NOT_FOUND','행동을 찾을 수 없습니다.');return action; }
  verification(action: Action): string {
    if(action.unavailable)return 'suspended';
    if(this.store.get<{suspended:boolean}>('action-status',action.id)?.suspended)return 'suspended';
    const evidence=this.store.list<Evidence>('evidence').find(e=>e.actionId===action.id&&e.kind==='live'&&e.outcome==='passed'&&e.connectorVersion===action.version);
    if(evidence && this.store.get<{version:string}>('released',action.id)?.version===action.version)return 'supported';
    return evidence?'account_verified':action.verification;
  }
  describe(action: Action, principal: Principal=admin) {
    const {schema,...dto}=action;
    const accounts=this.accounts(principal).filter(a=>a.enabled&&a.credentialType===action.credentialType&&a.allowedActions.includes(action.id));
    return {...dto,verification:this.verification(action),enabled:action.implemented&&!action.unavailable&&this.verification(action)!=='suspended'&&(!action.credentialType||accounts.length>0),accountIds:action.unavailable?[]:accounts.map(a=>a.id),disabledReason:action.unavailable?.reason??(!action.implemented?'구현과 검증이 필요한 후보 행동입니다.':this.verification(action)==='suspended'?'운영 중단':action.credentialType&&accounts.length===0?'계정 연결과 행동 권한이 필요합니다.':null)};
  }
  discover(principal: Principal, query='', serviceId?:string) {
    const normalized=query.trim().toLocaleLowerCase();
    return [...this.actions.values()].filter(a=>(principal.role==='admin'||!a.unavailable)&&canUse(principal,a.id)&&(!serviceId||a.serviceId===serviceId)&&`${a.title} ${a.description} ${a.id} ${a.category}`.toLocaleLowerCase().includes(normalized)).map(a=>this.describe(a,principal));
  }
  accounts(principal: Principal=admin): Omit<Account,'sealed'>[] {
    return this.store.list<Account>('account').filter(a=>principal.role==='admin'||principal.allowedAccountIds.includes(a.id)).map(({sealed,...account})=>account);
  }
  async saveAccount(raw: unknown, environmentManaged = false): Promise<Omit<Account,'sealed'>> {
    const input=z.object({id:z.string().uuid().optional(),label:z.string().trim().min(1).max(80),credentialType:z.string().min(1).max(100),allowedActions:z.array(z.string()).max(100),secrets:z.record(z.string().min(1).max(10000)).optional(),enabled:z.boolean().default(true)}).strict().parse(raw);
    const previous=input.id?this.store.get<Account>('account',input.id):undefined;
    if(previous?.managedBy==='environment'&&!environmentManaged)throw new ActionError('MANAGED_ACCOUNT','환경변수 관리 계정은 .env의 키·ACTIONS를 수정하고 서버를 재시작하세요.');
    if(input.id&&!previous)throw new ActionError('NOT_FOUND','계정을 찾을 수 없습니다.');
    if(previous&&previous.credentialType!==input.credentialType)throw new ActionError('INVALID_ACCOUNT','계정 종류는 변경할 수 없습니다.');
    if(!previous&&!input.secrets)throw new ActionError('MISSING_CREDENTIALS','계정 키를 입력하세요.');
    const secrets=input.secrets??await this.vault.open(previous!.sealed);
    const eligible=[...this.actions.values()].filter(a=>a.credentialType===input.credentialType);
    if(!eligible.length)throw new ActionError('INVALID_ACCOUNT','알 수 없는 계정 종류입니다.');
    for(const actionId of input.allowedActions){
      const a=eligible.find(a=>a.id===actionId);if(!a)throw new ActionError('INVALID_GRANT','계정에 맞지 않는 행동 권한입니다.');
      assertActionAvailable(a);
      if(a.requiredSecrets.some(k=>!secrets[k]?.trim()))throw new ActionError('MISSING_CREDENTIALS',`필수 키: ${a.requiredSecrets.join(', ')}`);
    }
    const allowedKeys=new Set(eligible.flatMap(a=>a.requiredSecrets).concat(['clientId','clientSecret','refreshToken']));
    if(Object.keys(secrets).some(k=>!allowedKeys.has(k)))throw new ActionError('INVALID_CREDENTIALS','지원하지 않는 키 필드입니다.');
    const account: Account={id:previous?.id??randomUUID(),label:input.label,credentialType:input.credentialType,allowedActions:input.allowedActions,enabled:input.enabled,createdAt:previous?.createdAt??now(),updatedAt:now(),sealed:await this.vault.seal(secrets),...(environmentManaged?{managedBy:'environment' as const}:{})};
    this.store.put('account',account.id,account);
    for(const job of this.store.allJobs())if(job.accountId===account.id&&(!account.enabled||!account.allowedActions.includes(job.actionId))&&!terminal.has(job.state))await this.cancel(admin,job.id);
    const {sealed,...result}=account; return result;
  }
  async removeAccount(id: string, environmentManaged = false): Promise<void> {
    if(this.store.get<Account>('account',id)?.managedBy==='environment'&&!environmentManaged)throw new ActionError('MANAGED_ACCOUNT','환경변수 관리 계정은 .env에서 키를 지우고 서버를 재시작하세요.');
    for(const job of this.store.allJobs())if(job.accountId===id&&!terminal.has(job.state))await this.cancel(admin,job.id);
    this.store.delete('account',id);
  }
  createClient(raw: unknown) {
    const v=z.object({name:z.string().trim().min(1).max(80),allowedActions:z.array(z.string()).min(1).max(200),allowedAccountIds:z.array(z.string().uuid()).default([])}).strict().parse(raw);
    for(const id of v.allowedActions)assertActionAvailable(this.action(id));
    for(const id of v.allowedAccountIds)if(!this.store.get<Account>('account',id))throw new ActionError('NOT_FOUND','계정을 찾을 수 없습니다.');
    const secret=token();const client:ClientRecord={...v,id:randomUUID(),role:'agent',tokenHash:hash(secret),revoked:false,createdAt:now()};
    this.store.put('client',client.id,client);const {tokenHash,...safe}=client;return {...safe,token:secret};
  }
  clients(){return this.store.list<ClientRecord>('client').map(({tokenHash,...client})=>client);}
  authenticate(secret: string): Principal | undefined {
    const digest=hash(secret);const record=this.store.list<ClientRecord>('client').find(c=>!c.revoked&&constantEqual(c.tokenHash,digest));
    if(!record)return undefined;
    const {tokenHash,revoked,createdAt,...principal}=record;return principal;
  }
  async revokeClient(id: string) {
    const c=this.store.get<ClientRecord>('client',id);if(!c)throw new ActionError('NOT_FOUND','클라이언트를 찾을 수 없습니다.');
    c.revoked=true;this.store.put('client',id,c);
    for(const job of this.store.allJobs())if(job.clientId===id&&!terminal.has(job.state))await this.cancel(admin,job.id);
  }
  private authorize(principal: Principal, action: Action, accountId?:string): void {
    if(!canUse(principal,action.id))throw new ActionError('FORBIDDEN','이 클라이언트에 허용되지 않은 행동입니다.');
    assertActionAvailable(action);
    if(!action.implemented)throw new ActionError('NOT_IMPLEMENTED','구현과 검증이 필요한 후보 행동입니다.');
    if(this.verification(action)==='suspended')throw new ActionError('UNAVAILABLE','중단된 행동입니다.');
    if(action.credentialType){
      const account=accountId?this.store.get<Account>('account',accountId):undefined;
      if(!account||!account.enabled||account.credentialType!==action.credentialType||!account.allowedActions.includes(action.id))throw new ActionError('ACCOUNT_REQUIRED','올바른 계정을 연결하고 해당 행동을 허용하세요.');
      if(principal.role!=='admin'&&!principal.allowedAccountIds.includes(account.id))throw new ActionError('FORBIDDEN','이 클라이언트에 허용되지 않은 계정입니다.');
    } else if(accountId)throw new ActionError('INVALID_ACCOUNT','이 행동에는 계정을 지정하지 않습니다.');
  }
  create(principal: Principal, raw: unknown): Job {
    if(this.closing)throw new ActionError('UNAVAILABLE','엔진이 종료 중입니다.');
    const r=requestSchema.parse(raw);const action=this.action(r.actionId);
    this.authorize(principal,action,r.accountId);
    const input=action.schema.parse(r.input) as Record<string,unknown>;
    const requestHash=hash(canonical({...r,input}));
    const old=this.store.findRequest(principal.id,r.idempotencyKey);
    if(old){if(old.requestHash!==requestHash)throw new ActionError('IDEMPOTENCY_CONFLICT','같은 요청 키의 내용을 변경할 수 없습니다.');return this.jobView(old,principal);}
    const job:Job={...r,input,id:randomUUID(),clientId:principal.id,requestHash,effect:action.effect,state:action.effect==='write'?'pending_approval':'queued',revision:1,dispatched:false,createdAt:now(),updatedAt:now(),interventions:0,events:[]};
    job.events.push({at:now(),state:job.state,message:action.effect==='write'?'사용자 승인 대기':'작업 접수'});
    this.store.insertJob(job);if(job.state==='queued')this.schedule(job.id);return job;
  }
  get(principal: Principal, id:string): Job {
    const job=this.store.job(id);if(!job||(principal.role!=='admin'&&job.clientId!==principal.id))throw new ActionError('NOT_FOUND','작업을 찾을 수 없습니다.');return this.jobView(job,principal);
  }
  private jobView(job:Job,principal:Principal):Job{
    this.expireResult(job);
    const unavailable=this.actions.get(job.actionId)?.unavailable;
    if(principal.role==='admin'||!unavailable)return job;
    const {result,...safe}=job;return {...safe,error:{code:'RESULT_UNAVAILABLE',message:unavailable.reason}};
  }
  jobs(principal: Principal=admin):Job[]{return this.store.jobs().filter(j=>principal.role==='admin'||j.clientId===principal.id).map(j=>this.jobView(j,principal));}
  private expireResult(job:Job):void{
    if(job.result!==undefined&&job.resultExpiresAt&&(!Number.isFinite(Date.parse(job.resultExpiresAt))||Date.parse(job.resultExpiresAt)<=Date.now())){
      delete job.result;job.error={code:'RESULT_EXPIRED',message:'공급자 결과의 사용기한이 만료되어 결과를 제거했습니다. 새 작업으로 다시 조회하세요.'};this.store.saveJob(job);
    }
  }
  digest(job:Job):string{return hash(canonical({actionId:job.actionId,version:this.action(job.actionId).version,accountId:job.accountId,input:job.input,revision:job.revision}));}
  private owner(job:Job):Principal {
    if(job.clientId===admin.id)return admin;
    const owner=this.store.get<ClientRecord>('client',job.clientId);
    if(!owner||owner.revoked)throw new ActionError('FORBIDDEN','요청한 클라이언트가 해제됐습니다.');return owner;
  }
  edit(principal:Principal,id:string,input:unknown,revision:number):Job{
    if(principal.role!=='admin')throw new ActionError('FORBIDDEN','사용자만 승인 내용을 수정할 수 있습니다.');
    const job=this.get(principal,id);
    if(!['pending_approval','awaiting_auth','awaiting_user'].includes(job.state)||job.revision!==revision)throw new ActionError('STALE_REVISION','작업이 변경됐습니다. 새로 확인하세요.');
    const action=this.action(job.actionId);job.input=action.schema.parse(input);job.revision++;delete job.approvalHash;delete job.error;
    job.state=action.effect==='write'?'pending_approval':'awaiting_user';this.save(job,'내용 수정 · 승인 초기화');return job;
  }
  approve(principal:Principal,id:string,revision:number,digest:string):Job{
    if(principal.role!=='admin')throw new ActionError('FORBIDDEN','작업 승인은 관리 화면에서 사용자가 수행합니다.');
    const job=this.get(principal,id);
    if(job.state!=='pending_approval'||job.revision!==revision||!constantEqual(this.digest(job),digest))throw new ActionError('STALE_APPROVAL','승인 내용이 변경됐습니다. 다시 확인하세요.');
    this.authorize(this.owner(job),this.action(job.actionId),job.accountId);
    job.approvalHash=digest;job.interventions++;job.state='queued';this.save(job,'사용자 승인');this.schedule(id);return job;
  }
  resume(principal:Principal,id:string):Job{
    const job=this.get(principal,id);
    if(!['awaiting_auth','awaiting_user'].includes(job.state))throw new ActionError('INVALID_STATE','이 작업은 재개할 수 없습니다. 결과 확인이 필요한 쓰기는 재전송하지 않습니다.');
    const action=this.action(job.actionId);this.authorize(this.owner(job),action,job.accountId);
    job.state=action.effect==='write'?'pending_approval':'queued';job.dispatched=false;job.interventions++;delete job.approvalHash;delete job.error;delete job.handoff;
    this.save(job,'사용자 작업 재개');if(job.state==='queued')this.schedule(id);return job;
  }
  async cancel(principal:Principal,id:string):Promise<Job>{
    const job=this.get(principal,id);if(terminal.has(job.state))return job;
    if(job.state==='needs_review')return job;
    const uncertain=job.dispatched&&this.action(job.actionId).effect==='write';
    job.state=uncertain?'needs_review':'cancelled';job.finishedAt=now();
    if(uncertain)job.error={code:'CANCEL_AFTER_DISPATCH',message:'전송 후 취소됐습니다. 공급자에서 실제 결과를 확인하세요.'};
    this.save(job,uncertain?'취소 요청 · 결과 확인 필요':'작업 취소');this.active.get(id)?.abort();return job;
  }
  resolve(principal:Principal,id:string,outcome:'succeeded'|'failed',note:string):Job{
    if(principal.role!=='admin')throw new ActionError('FORBIDDEN','사용자만 결과를 확인할 수 있습니다.');
    const job=this.get(principal,id);if(job.state!=='needs_review')throw new ActionError('INVALID_STATE','결과 확인 대기 작업이 아닙니다.');
    if(this.active.has(id))throw new ActionError('INVALID_STATE','실행 종료를 기다린 뒤 확인하세요.');
    job.state=outcome;job.finishedAt=now();job.result={confirmation:'user',note};delete job.error;this.save(job,`사용자 확인: ${note}`);return job;
  }
  private save(job:Job,message:string):void{job.updatedAt=now();job.events.push({at:job.updatedAt,state:job.state,message});this.store.saveJob(job);}
  private schedule(id:string):void{
    const task=new Promise<void>(resolve=>setImmediate(resolve)).then(()=>this.run(id)).catch(()=>{}).finally(()=>this.tasks.delete(task));this.tasks.add(task);
  }
  async idle():Promise<void>{await Promise.all([...this.tasks]);}
  private async run(id:string):Promise<void>{
    let job=this.store.job(id);if(!job||job.state!=='queued')return;
    const action=this.action(job.actionId);const controller=new AbortController();this.active.set(id,controller);
    let secrets:Record<string,string>={};
    try{
      this.authorize(this.owner(job),action,job.accountId);
      if(action.effect==='write'&&job.approvalHash!==this.digest(job))throw new ActionError('APPROVAL_REQUIRED','승인이 필요합니다.','pending_approval');
      job.state='running';job.startedAt=now();this.save(job,'실행 시작');
      if(job.accountId)secrets=await this.vault.open(this.store.get<Account>('account',job.accountId)!.sealed);
      if(action.requiredSecrets.some(k=>!secrets[k]))throw new ActionError('AUTH_REQUIRED','계정 키를 갱신하세요.','awaiting_auth');
      if(controller.signal.aborted)return;
      const execute=this.executors.get(action.id)!;
      const result=await execute(action,{job,secrets,signal:controller.signal,dispatch:()=>{
        const latest=this.store.job(id)!;if(latest.state!=='running'||controller.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');
        this.authorize(this.owner(latest),action,latest.accountId);
        latest.dispatched=true;job=latest;this.store.saveJob(latest);
      }});
      const latest=this.store.job(id)!;if(latest.state!=='running')return;
      latest.state='succeeded';latest.finishedAt=now();latest.result={data:redact(result.data,Object.values(secrets)),evidence:result.evidence,contentTrust:'external_data'};
      if(action.resultTtlMs)latest.resultExpiresAt=new Date(Date.parse(latest.startedAt??latest.createdAt)+action.resultTtlMs).toISOString();
      this.save(latest,'결과 확인 완료');
      this.store.put('evidence',randomUUID(),{actionId:action.id,kind:['browser','handoff','partnership'].includes(action.method)? 'mock':this.evidenceMode,outcome:'passed',at:now(),jobId:id,connectorVersion:action.version,note:result.evidence} satisfies Evidence);
    }catch(error){
      const latest=this.store.job(id)!;if(latest.state!=='running'&&latest.state!=='queued')return;
      const e=error instanceof ActionError?error:new ActionError('EXECUTION_INTERRUPTED',action.effect==='write'&&latest.dispatched?'응답을 확인하지 못했습니다. 공급자 화면에서 결과를 확인하세요.':'실행에 실패했습니다. 연결 상태를 확인하세요.',action.effect==='write'&&latest.dispatched?'needs_review':'failed');
      latest.state=e.state;latest.error={code:e.code,message:String(redact(e.message,Object.values(secrets)))};
      if(e.handoff)latest.handoff=e.handoff;
      if(terminal.has(e.state))latest.finishedAt=now();
      this.save(latest,latest.error.message);
    }finally{this.active.delete(id);}
  }
  release(actionId:string):void{
    const action=this.action(actionId);if(this.verification(action)!=='account_verified')throw new ActionError('LIVE_EVIDENCE_REQUIRED','해당 버전의 실제 계정 성공 검증이 필요합니다.');
    this.store.put('released',actionId,{version:action.version,at:now()});
  }
  async suspend(actionId:string,suspended:boolean):Promise<void>{
    if(!suspended)assertActionAvailable(this.action(actionId));
    this.action(actionId);this.store.put('action-status',actionId,{suspended});
    if(suspended)for(const job of this.store.allJobs())if(job.actionId===actionId&&!terminal.has(job.state))await this.cancel(admin,job.id);
  }
  metrics(){
    const jobs=this.store.allJobs();const byAction=[...this.actions.values()].map(a=>{const rows=jobs.filter(j=>j.actionId===a.id);return {actionId:a.id,requests:rows.length,succeeded:rows.filter(j=>j.state==='succeeded').length,failed:rows.filter(j=>j.state==='failed').length,needsReview:rows.filter(j=>j.state==='needs_review').length,interventions:rows.reduce((n,j)=>n+j.interventions,0)};});
    return {jobs:jobs.length,pending:jobs.filter(j=>['pending_approval','awaiting_auth','awaiting_user','needs_review'].includes(j.state)).length,verifiedServices:new Set([...this.actions.values()].filter(a=>['account_verified','supported'].includes(this.verification(a))).map(a=>a.serviceId)).size,supportedActions:[...this.actions.values()].filter(a=>this.verification(a)==='supported').length,byAction};
  }
  async close():Promise<void>{this.closing=true;for(const id of this.active.keys())await this.cancel(admin,id);await this.idle();}
}
