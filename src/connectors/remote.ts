import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Ajv } from 'ajv';
import { z } from 'zod';
import { Engine } from '../core/engine.js';
import { hash, redact } from '../core/security.js';
import { McpOAuth, remoteOAuthConfig } from '../core/mcp-oauth.js';
import { oauthUrl } from '../core/mcp-oauth-network.js';
import { tossConsolePreset } from '../research/mcp-providers.js';
import { ActionError, type Action, type RemoteServer } from '../types.js';

const inputSchema=z.object({name:z.string().trim().min(1).max(80),url:z.string().url().max(1000),bearerToken:z.string().max(10000).optional(),tools:z.array(z.string().min(1).max(100)).min(1).max(30)}).strict();
export class RemoteRegistry {
  readonly oauth: McpOAuth;
  private closing = false;
  constructor(readonly engine:Engine){this.oauth=new McpOAuth(engine,id=>this.completeOAuth(id));for(const server of engine.store.list<RemoteServer>('remote'))if(server.enabled)this.register(server);}
  private active(id:string){const server=this.engine.store.get<RemoteServer>('remote',id);if(this.closing||!server?.enabled)throw new ActionError('UPSTREAM_DISABLED','해제된 MCP 서버입니다.');return server;}
  private async client(server:RemoteServer,setup=false,signal?:AbortSignal){
    const credentials=server.authType==='oauth'?await this.oauth.access(server.id,setup):await this.engine.vault.open(server.sealed).then(secrets=>({token:secrets.bearerToken,secrets:Object.values(secrets)}));
    this.active(server.id);signal?.throwIfAborted();
    const client=new Client({name:'koreai-upstream',version:'0.1.0'});
    const transport=new StreamableHTTPClientTransport(new URL(server.url),{
      // Deliberately omit SDK authProvider: a 401 must never replay a dispatched tool call.
      requestInit:{headers:credentials.token?{Authorization:`Bearer ${credentials.token}`}:{},redirect:'error'},
      fetch:async(input,init)=>{if(new URL(input instanceof Request?input.url:String(input)).href!==server.url)throw new Error('MCP endpoint changed');return fetch(input,{...init,redirect:'error',signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),...(signal?[signal]:[]),AbortSignal.timeout(30_000)])});},
    });
    try{await client.connect(transport);}catch(error){await transport.close();if(error instanceof StreamableHTTPError&&[401,403].includes(error.code??0)){if(server.authType==='oauth'&&!setup)await this.oauth.block(server.id);throw new ActionError('UPSTREAM_AUTH_REQUIRED','MCP 서버에 다시 로그인하거나 연결 인증을 확인하세요.','awaiting_auth');}throw new ActionError('UPSTREAM_UNAVAILABLE','MCP 서버 연결에 실패했습니다. 주소와 인증을 확인하세요.','awaiting_user');}
    return {client,secrets:credentials.secrets};
  }
  private async collect(server:RemoteServer,setup=false){
    const {client,secrets}=await this.client(server,setup);
    try{
      let cursor:string|undefined;const found:RemoteServer['tools']=[];const requested=server.requestedTools??server.tools.map(tool=>tool.name);
      for(let page=0;page<10;page++){
        const result=redact(await client.listTools(cursor?{cursor}:{}),secrets) as Awaited<ReturnType<Client['listTools']>>;
        for(const tool of result.tools)if(requested.includes(tool.name)&&!found.some(old=>old.name===tool.name))found.push({name:tool.name,description:tool.description??tool.name,inputSchema:tool.inputSchema});
        cursor=result.nextCursor;if(!cursor)break;
      }
      if(requested.some(name=>!found.some(tool=>tool.name===name)))throw new ActionError('TOOL_NOT_FOUND','요청한 도구를 서버에서 찾을 수 없습니다.');
      return found;
    }finally{await client.close();}
  }
  async add(raw:unknown){
    const v=inputSchema.parse(raw);const url=new URL(v.url);
    const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||(!(url.protocol==='https:')&&!(loopback&&url.protocol==='http:')))throw new ActionError('INVALID_URL','HTTPS 또는 로컬 HTTP MCP 주소를 사용하세요. 주소에 비밀 키를 넣지 마세요.');
    const server:RemoteServer={id:randomUUID(),name:v.name,url:url.href,sealed:await this.engine.vault.seal(v.bearerToken?{bearerToken:v.bearerToken}:{}),tools:[],requestedTools:[...new Set(v.tools)],authType:'bearer',authStatus:'connected',enabled:true,createdAt:new Date().toISOString()};
    this.engine.store.put('remote',server.id,server);
    try{
      server.tools=await this.collect(server);this.register(server);this.engine.store.put('remote',server.id,server);
      return this.safe(server);
    }catch(error){this.engine.store.delete('remote',server.id);throw error;}
  }
  async addOAuth(raw:unknown,ownerHash:string,binding:string){
    const v=inputSchema.omit({bearerToken:true}).extend({oauth:remoteOAuthConfig.default({}),presetId:z.literal('toss-console').optional()}).parse(raw),url=oauthUrl(v.url);
    if(v.presetId&&(url.href!==tossConsolePreset.url||v.oauth.issuerUrl&&oauthUrl(v.oauth.issuerUrl).href!==oauthUrl(tossConsolePreset.oauth.issuerUrl).href))throw new ActionError('OAUTH_PRESET','프리셋의 서버·인증 서버 주소가 일치하지 않습니다.');
    const config=v.presetId?{...tossConsolePreset.oauth,...v.oauth,issuerUrl:tossConsolePreset.oauth.issuerUrl}:v.oauth;
    const server:RemoteServer={id:randomUUID(),name:v.name,url:url.href,sealed:await this.oauth.seed(config),tools:[],requestedTools:[...new Set(v.tools)],authType:'oauth',authStatus:'awaiting_auth',...(v.presetId?{presetId:v.presetId}:{}),enabled:true,createdAt:new Date().toISOString()};
    this.engine.store.put('remote',server.id,server);
    try{return await this.oauth.start(server.id,ownerHash,binding);}catch(error){await this.oauth.erase(server.id);this.engine.store.delete('remote',server.id);throw error;}
  }
  private async completeOAuth(id:string){
    const server=this.active(id),tools=await this.collect(server,true);this.active(id);
    const next={...this.active(id),tools};this.register(next);
    const account=await this.engine.saveAccount({label:`${server.name} · MCP OAuth`.slice(0,80),credentialType:`mcp-oauth-${id}`,allowedActions:tools.map(tool=>`mcp.${id}.${tool.name}`),secrets:{connectionId:id}});
    try{this.engine.store.put('remote',id,{...this.active(id),tools,accountId:account.id,authStatus:'connected',oauthError:undefined});}
    catch(error){await this.engine.removeAccount(account.id);throw error;}
  }
  private register(server:RemoteServer){
    const ajv=new Ajv({strict:false,allErrors:false});
    const actions:Action[]=server.tools.map(t=>{
      const validate=ajv.compile(t.inputSchema);
      const schema=z.record(z.unknown()).superRefine((input,ctx)=>{if(!validate(input))ctx.addIssue({code:'custom',message:'상위 MCP 도구의 입력 형식과 일치하지 않습니다.'});});
      return {id:`mcp.${server.id}.${t.name}`,serviceId:`mcp-${server.id}`,connectorId:`mcp-${server.id}`,title:`${server.name} · ${t.name}`,description:t.description,category:'사용자 MCP',effect:'write',method:'mcp',schema,inputSchema:t.inputSchema,...(server.authType==='oauth'?{credentialType:`mcp-oauth-${server.id}`} : {}),requiredSecrets:server.authType==='oauth'?['connectionId']:[],scopes:[],sourceUrl:server.url,checkedAt:null,verification:'unresearched',resultCheck:'상위 MCP 성공 응답; 외부 실행 결과 추가 확인 권장',domains:[new URL(server.url).hostname],version:server.authType==='oauth'?`0.2.0-${hash(JSON.stringify(t)).slice(0,12)}`:'0.1.0',maintainer:'사용자 설치',origin:'user',implemented:true};
    });
    this.engine.register(actions,async(action,ctx)=>{
      const current=this.engine.store.get<RemoteServer>('remote',server.id);
      if(!current?.enabled)throw new ActionError('UPSTREAM_DISABLED','해제된 MCP 서버입니다.');
      if(current.authType==='oauth'&&ctx.job.accountId!==current.accountId)throw new ActionError('UPSTREAM_ACCOUNT','이 MCP 연결의 현재 계정이 아닙니다.','awaiting_auth');
      const {client,secrets}=await this.client(current,false,ctx.signal);
      try{
        const name=action.id.slice(`mcp.${server.id}.`.length);
        // readOnlyHint is untrusted. Every imported call passes the write approval gate.
        ctx.dispatch();const result=await client.callTool({name,arguments:ctx.job.input},undefined,{signal:ctx.signal,timeout:30_000});
        if(result.isError)throw new ActionError('UPSTREAM_ERROR','상위 MCP 도구가 오류를 반환했습니다. 실제 결과를 확인하세요.','needs_review');
        return {data:redact(result,secrets),evidence:'상위 MCP 도구 성공 응답 (사용자 설치 커넥터)'};
      }catch(error){if(error instanceof StreamableHTTPError&&[401,403].includes(error.code??0)){if(current.authType==='oauth')await this.oauth.block(current.id);throw new ActionError('UPSTREAM_AUTH_UNCERTAIN','전송 후 인증 오류가 발생했습니다. 다시 보내지 말고 공급자에서 실제 결과를 확인하세요.','needs_review');}throw error;}
      finally{await client.close();}
    });
  }
  private safe({sealed,...server}:RemoteServer){return {...server,oauthPending:server.authType==='oauth'&&this.engine.store.list<{remoteId:string;expiresAt:number}>('remote-oauth-flow').some(flow=>flow.remoteId===server.id&&flow.expiresAt>Date.now())};}
  list(){return this.engine.store.list<RemoteServer>('remote').map(s=>this.safe(s));}
  async remove(id:string){
    const server=this.engine.store.get<RemoteServer>('remote',id);if(!server)throw new ActionError('NOT_FOUND','MCP 서버를 찾을 수 없습니다.');
    server.enabled=false;this.engine.store.put('remote',id,server);
    for(const action of this.engine.actions.values())if(action.connectorId===`mcp-${id}`)await this.engine.suspend(action.id,true);
    if(server.accountId)await this.engine.removeAccount(server.accountId);
    await this.oauth.erase(id);
  }
  async close(){this.closing=true;await this.oauth.close();}
}
