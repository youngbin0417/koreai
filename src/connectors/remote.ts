import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Ajv } from 'ajv';
import { z } from 'zod';
import { Engine } from '../core/engine.js';
import { redact } from '../core/security.js';
import { ActionError, type Action, type RemoteServer } from '../types.js';

const inputSchema=z.object({name:z.string().trim().min(1).max(80),url:z.string().url().max(1000),bearerToken:z.string().max(10000).optional(),tools:z.array(z.string().min(1).max(100)).min(1).max(30)}).strict();
export class RemoteRegistry {
  constructor(readonly engine:Engine){for(const server of engine.store.list<RemoteServer>('remote'))if(server.enabled)this.register(server);}
  private async client(server:RemoteServer){
    const secrets=await this.engine.vault.open(server.sealed);
    const client=new Client({name:'koreai-upstream',version:'0.1.0'});
    const transport=new StreamableHTTPClientTransport(new URL(server.url),{
      requestInit:{headers:secrets.bearerToken?{Authorization:`Bearer ${secrets.bearerToken}`}:{},redirect:'error'},
      fetch:async(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(30_000)])}),
    });
    try{await client.connect(transport);}catch{await transport.close();throw new ActionError('UPSTREAM_UNAVAILABLE','MCP 서버 연결에 실패했습니다. 주소와 인증을 확인하세요.');}
    return {client,secrets};
  }
  async add(raw:unknown){
    const v=inputSchema.parse(raw);const url=new URL(v.url);
    const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||(!(url.protocol==='https:')&&!(loopback&&url.protocol==='http:')))throw new ActionError('INVALID_URL','HTTPS 또는 로컬 HTTP MCP 주소를 사용하세요. 주소에 비밀 키를 넣지 마세요.');
    const server:RemoteServer={id:randomUUID(),name:v.name,url:url.href,sealed:await this.engine.vault.seal(v.bearerToken?{bearerToken:v.bearerToken}:{}),tools:[],enabled:true,createdAt:new Date().toISOString()};
    const {client,secrets}=await this.client(server);
    try{
      let cursor:string|undefined;const found:RemoteServer['tools']=[];
      for(let page=0;page<10;page++){
        const received=await client.listTools(cursor?{cursor}:{});
        const result=redact(received,Object.values(secrets)) as typeof received;
        for(const t of result.tools)if(v.tools.includes(t.name))found.push({name:t.name,description:t.description??t.name,inputSchema:t.inputSchema});
        cursor=result.nextCursor;if(!cursor)break;
      }
      if(v.tools.some(t=>!found.find(f=>f.name===t)))throw new ActionError('TOOL_NOT_FOUND','요청한 도구를 서버에서 찾을 수 없습니다.');
      server.tools=found;this.register(server);this.engine.store.put('remote',server.id,server);
      return this.safe(server);
    }finally{await client.close();}
  }
  private register(server:RemoteServer){
    const ajv=new Ajv({strict:false,allErrors:false});
    const actions:Action[]=server.tools.map(t=>{
      const validate=ajv.compile(t.inputSchema);
      const schema=z.record(z.unknown()).superRefine((input,ctx)=>{if(!validate(input))ctx.addIssue({code:'custom',message:'상위 MCP 도구의 입력 형식과 일치하지 않습니다.'});});
      return {id:`mcp.${server.id}.${t.name}`,serviceId:`mcp-${server.id}`,connectorId:`mcp-${server.id}`,title:`${server.name} · ${t.name}`,description:t.description,category:'사용자 MCP',effect:'write',method:'mcp',schema,inputSchema:t.inputSchema,requiredSecrets:[],scopes:[],sourceUrl:server.url,checkedAt:null,verification:'unresearched',resultCheck:'상위 MCP 성공 응답; 외부 실행 결과 추가 확인 권장',domains:[new URL(server.url).hostname],version:'0.1.0',maintainer:'사용자 설치',origin:'user',implemented:true};
    });
    this.engine.register(actions,async(action,ctx)=>{
      const current=this.engine.store.get<RemoteServer>('remote',server.id);
      if(!current?.enabled)throw new ActionError('UPSTREAM_DISABLED','해제된 MCP 서버입니다.');
      const {client,secrets}=await this.client(current);
      try{
        const name=action.id.slice(`mcp.${server.id}.`.length);
        // readOnlyHint is untrusted. Every imported call passes the write approval gate.
        ctx.dispatch();const result=await client.callTool({name,arguments:ctx.job.input},undefined,{signal:ctx.signal,timeout:30_000});
        if(result.isError)throw new ActionError('UPSTREAM_ERROR','상위 MCP 도구가 오류를 반환했습니다. 실제 결과를 확인하세요.','needs_review');
        return {data:redact(result,Object.values(secrets)),evidence:'상위 MCP 도구 성공 응답 (사용자 설치 커넥터)'};
      }finally{await client.close();}
    });
  }
  private safe({sealed,...server}:RemoteServer){return server;}
  list(){return this.engine.store.list<RemoteServer>('remote').map(s=>this.safe(s));}
  async remove(id:string){
    const server=this.engine.store.get<RemoteServer>('remote',id);if(!server)throw new ActionError('NOT_FOUND','MCP 서버를 찾을 수 없습니다.');
    for(const action of this.engine.actions.values())if(action.connectorId===`mcp-${id}`)await this.engine.suspend(action.id,true);
    server.enabled=false;this.engine.store.put('remote',id,server);
  }
}
