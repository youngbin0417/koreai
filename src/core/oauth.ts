import { z } from 'zod';
import { Engine } from './engine.js';
import { hash, token } from './security.js';
import { ActionError, type Account } from '../types.js';

interface Flow { sealed:string; expires:number }
const providers={
  'naver-user':{authorize:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token'},
  'kakao-user':{authorize:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token'},
};
export class OAuth {
  baseUrl='';
  constructor(readonly engine:Engine,readonly fetcher:typeof fetch=fetch){}
  async start(raw:unknown){
    const v=z.object({credentialType:z.enum(['naver-user','kakao-user']),clientId:z.string().min(1).max(1000),clientSecret:z.string().max(1000).default(''),label:z.string().trim().min(1).max(80),allowedActions:z.array(z.string()).min(1),accountId:z.string().uuid().optional()}).strict().parse(raw);
    if(v.credentialType==='naver-user'&&!v.clientSecret)throw new ActionError('MISSING_CREDENTIALS','네이버 Client Secret이 필요합니다.');
    for(const id of v.allowedActions)if(this.engine.action(id).credentialType!==v.credentialType)throw new ActionError('INVALID_GRANT','계정과 행동이 일치하지 않습니다.');
    if(v.accountId){const old=this.engine.store.get<Account>('account',v.accountId);if(old?.managedBy==='environment')throw new ActionError('MANAGED_ACCOUNT','.env에서 토큰을 수정하고 서버를 재시작하세요.');if(!old||old.credentialType!==v.credentialType)throw new ActionError('INVALID_ACCOUNT','갱신할 계정이 일치하지 않습니다.');}
    const state=token();const redirectUri=`${this.baseUrl}/oauth/callback`;
    this.engine.store.put('oauth',hash(state),{sealed:await this.engine.vault.seal({...v,allowedActions:JSON.stringify(v.allowedActions),accountId:v.accountId??'',state,redirectUri}),expires:Date.now()+600_000} satisfies Flow);
    const url=new URL(providers[v.credentialType].authorize);
    url.search=new URLSearchParams({response_type:'code',client_id:v.clientId,redirect_uri:redirectUri,state,...(v.credentialType==='kakao-user'?{scope:'talk_message'}:{})}).toString();
    return {url:url.href,redirectUri};
  }
  async callback(state:string,code?:string){
    const key=hash(state);const flow=this.engine.store.get<Flow>('oauth',key);
    this.engine.store.delete('oauth',key);
    if(!flow||flow.expires<Date.now())throw new ActionError('OAUTH_EXPIRED','로그인 요청이 만료됐거나 이미 사용됐습니다. 관리 화면에서 다시 시작하세요.');
    if(!code)throw new ActionError('OAUTH_DENIED','서비스 로그인이 취소됐습니다.');
    const info=await this.engine.vault.open(flow.sealed);const type=info.credentialType as keyof typeof providers;
    if(info.accountId&&this.engine.store.get<Account>('account',info.accountId)?.managedBy==='environment')throw new ActionError('MANAGED_ACCOUNT','.env에서 토큰을 수정하고 서버를 재시작하세요.');
    const response=await this.fetcher(providers[type].token,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20_000),body:new URLSearchParams({grant_type:'authorization_code',client_id:info.clientId!,...(info.clientSecret?{client_secret:info.clientSecret}:{}),code,state,redirect_uri:info.redirectUri!})});
    const result=await response.json() as Record<string,unknown>;
    if(!response.ok||typeof result.access_token!=='string')throw new ActionError('OAUTH_FAILED','서비스가 접근 토큰을 발급하지 않았습니다. 앱 설정과 콜백 주소를 확인하세요.');
    return this.engine.saveAccount({...(info.accountId?{id:info.accountId}:{}),label:info.label,credentialType:type,allowedActions:JSON.parse(info.allowedActions!),secrets:{clientId:info.clientId!,...(info.clientSecret?{clientSecret:info.clientSecret}:{}),accessToken:result.access_token,...(typeof result.refresh_token==='string'?{refreshToken:result.refresh_token}:{})}});
  }
  async refresh(id:string){
    const account=this.engine.store.get<Account>('account',id);
    if(account?.managedBy==='environment')throw new ActionError('MANAGED_ACCOUNT','.env에서 토큰을 수정하고 서버를 재시작하세요.');
    if(!account||!(account.credentialType in providers))throw new ActionError('INVALID_ACCOUNT','OAuth 갱신을 지원하는 계정이 아닙니다.');
    const secrets=await this.engine.vault.open(account.sealed);
    if(!secrets.refreshToken||!secrets.clientId)throw new ActionError('AUTH_REQUIRED','갱신 토큰이 없습니다. OAuth로 다시 연결하거나 토큰을 직접 갱신하세요.');
    const response=await this.fetcher(providers[account.credentialType as keyof typeof providers].token,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20_000),body:new URLSearchParams({grant_type:'refresh_token',client_id:secrets.clientId,...(secrets.clientSecret?{client_secret:secrets.clientSecret}:{}),refresh_token:secrets.refreshToken})});
    const result=await response.json() as Record<string,unknown>;
    if(!response.ok||typeof result.access_token!=='string')throw new ActionError('AUTH_REQUIRED','토큰 갱신에 실패했습니다. 서비스에 다시 로그인하세요.');
    const {sealed,...safe}=account;
    return this.engine.saveAccount({id:safe.id,label:safe.label,credentialType:safe.credentialType,allowedActions:safe.allowedActions,enabled:safe.enabled,secrets:{...secrets,accessToken:result.access_token,...(typeof result.refresh_token==='string'?{refreshToken:result.refresh_token}:{})}});
  }
}
