import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { WindowsVault } from '../src/core/security.js';
import { TestVault,tempDir,providerMock,fakeSecrets,inputFor } from './helpers.js';

type Runtime=Awaited<ReturnType<typeof createRuntime>>;
async function setup(){const mock=providerMock();const runtime=await createRuntime({dataDir:tempDir('http'),port:0,vault:new TestVault(),fetcher:mock.fetcher,bootstrapCode:'test-admin-bootstrap-code',headless:true,evidenceMode:'mock'});return {runtime,mock};}
async function login(r:Runtime){const response=await fetch(`${r.baseUrl}/api/bootstrap`,{method:'POST',headers:{Origin:r.baseUrl,'Content-Type':'application/json'},body:JSON.stringify({code:r.bootstrapCode})});assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0]!;}
function http(r:Runtime,path:string,auth:string,method='GET',body?:unknown){return fetch(`${r.baseUrl}/api${path}`,{method,headers:{Origin:r.baseUrl,...(auth.startsWith('koreai_session=')?{Cookie:auth}:{Authorization:`Bearer ${auth}`}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}

test('HTTP limits host/origin, separates admin from agent, and scopes account metadata',async()=>{
  const {runtime:r}=await setup();try{
    assert.equal((await fetch(`${r.baseUrl}/api/state`)).status,401);
    assert.equal((await fetch(`${r.baseUrl}/api/health`,{headers:{Origin:'https://evil.example'}})).status,403);
    const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{const q=httpRequest(`${r.baseUrl}/api/health`,{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});q.on('error',reject);q.end();});
    assert.equal(hostStatus,403);
    const cookie=await login(r);const replay=await fetch(`${r.baseUrl}/api/bootstrap`,{method:'POST',headers:{Origin:r.baseUrl,'Content-Type':'application/json'},body:JSON.stringify({code:r.bootstrapCode})});assert.equal(replay.status,401);
    const a=await r.engine.saveAccount({label:'밴드',credentialType:'band-user',allowedActions:['band.publish'],secrets:{accessToken:fakeSecrets.accessToken}});
    const c=r.engine.createClient({name:'Agent',allowedActions:['band.publish'],allowedAccountIds:[a.id]});
    const session=await (await http(r,'/session',c.token)).json();assert(!JSON.stringify(session).includes('tokenHash'));
    const metadata=await (await http(r,'/accounts',c.token)).json();assert(!JSON.stringify(metadata).includes(fakeSecrets.accessToken));
    assert.equal((await http(r,'/clients',c.token,'POST',{name:'elevate',allowedActions:['band.publish']})).status,403);
    assert.equal((await http(r,'/browser/demo-login',c.token,'POST',{})).status,403);
    const response=await http(r,'/jobs',c.token,'POST',{actionId:'band.publish',accountId:a.id,input:inputFor('band.publish'),idempotencyKey:randomUUID()});assert.equal(response.status,202);const job=await response.json();
    assert.equal((await http(r,`/jobs/${job.id}/approve`,c.token,'POST',{revision:1,digest:r.engine.digest(job)})).status,403);
    assert.equal((await http(r,`/jobs/${job.id}/approve`,cookie,'POST',{revision:1,digest:r.engine.digest(job)})).status,200);await r.engine.idle();assert.equal(r.engine.get(admin,job.id).state,'succeeded');
    const c2=r.engine.createClient({name:'Other agent',allowedActions:['band.publish'],allowedAccountIds:[a.id]});assert.equal((await http(r,`/jobs/${job.id}`,c2.token)).status,404);
    assert.equal((await fetch(`${r.baseUrl}/api/clients`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    const logout=await http(r,'/logout',cookie,'POST',{});assert.equal(logout.status,200);assert.equal((await http(r,'/state',cookie)).status,401);
  }finally{await r.close();}
});

test('OAuth state is single use and credentials are encrypted, never sent to browser response',async()=>{
  let calls=0;const fetcher:typeof fetch=async(input,init)=>{calls++;assert.equal(new URL(String(input)).hostname,'nid.naver.com');const form=new URLSearchParams(String(init?.body));assert.equal(form.get('code'),'provider-code');return Response.json({access_token:fakeSecrets.accessToken,refresh_token:'mock-refresh-token-12345'});};
  const r=await createRuntime({dataDir:tempDir('oauth'),port:0,vault:new TestVault(),fetcher,bootstrapCode:'oauth-bootstrap'});
  try{
    const cookie=await login(r);const start=await http(r,'/oauth/start',cookie,'POST',{credentialType:'naver-user',clientId:fakeSecrets.clientId,clientSecret:fakeSecrets.clientSecret,label:'OAuth 계정',allowedActions:['naver.calendar.create']});
    assert.equal(start.status,200);const info=await start.json();const state=new URL(info.url).searchParams.get('state');assert(state);assert(!JSON.stringify(info).includes(fakeSecrets.clientSecret));
    assert.equal((await fetch(`${r.baseUrl}/oauth/callback?state=wrong&code=provider-code`)).status,400);assert.equal(calls,0);
    const done=await fetch(`${r.baseUrl}/oauth/callback?state=${state}&code=provider-code`);assert.equal(done.status,200);assert(!(await done.text()).includes(fakeSecrets.accessToken));assert.equal(calls,1);
    assert.equal((await fetch(`${r.baseUrl}/oauth/callback?state=${state}&code=provider-code`)).status,400);assert.equal(calls,1);
    assert.equal(r.engine.accounts().length,1);assert(!JSON.stringify(r.store.list('account')).includes(fakeSecrets.accessToken));
  }finally{await r.close();}
});

test('SDK and independent JSON-RPC clients both discover and execute via MCP stdio',async()=>{
  const {runtime:r,mock}=await setup();let transport:StdioClientTransport|undefined;let raw:ReturnType<typeof spawn>|undefined;
  try{
    const a=await r.engine.saveAccount({label:'검색',credentialType:'kakao-app',allowedActions:['kakao.map.places'],secrets:{restApiKey:fakeSecrets.restApiKey}});
    const credential=r.engine.createClient({name:'SDK client',allowedActions:['kakao.map.places'],allowedAccountIds:[a.id]});
    const env=Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined));
    const client=new Client({name:'sdk-test-client',version:'1.0.0'});transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/mcp.ts'],env:{...env,KOREAI_URL:r.baseUrl,KOREAI_TOKEN:credential.token},stderr:'pipe'});
    await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,8);assert(!tools.tools.some(t=>t.name.includes('approve')));
    const found=await client.callTool({name:'koreai_find_actions',arguments:{query:'장소'}});assert(JSON.stringify(found).includes('kakao.map.places'));
    const execute=await client.callTool({name:'koreai_execute',arguments:{actionId:'kakao.map.places',accountId:a.id,input:{query:'서울'},idempotencyKey:randomUUID()}});assert(!execute.isError);await r.engine.idle();assert.equal(mock.requests.length,1);
    await client.close();transport=undefined;

    const second=r.engine.createClient({name:'raw-jsonrpc-client',allowedActions:['kakao.map.places'],allowedAccountIds:[a.id]});
    raw=spawn(process.execPath,['--import','tsx','src/mcp.ts'],{env:{...env,KOREAI_URL:r.baseUrl,KOREAI_TOKEN:second.token},stdio:['pipe','pipe','pipe'],windowsHide:true});
    raw.stderr!.resume();const pending=new Map<number,(v:any)=>void>();const reader=createInterface({input:raw.stdout!});reader.on('line',line=>{const message=JSON.parse(line);if(typeof message.id==='number')pending.get(message.id)?.(message);});
    const send=(id:number,method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('raw MCP timeout')),15000);pending.set(id,value=>{clearTimeout(timer);pending.delete(id);resolve(value);});raw!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
    const hello=await send(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'independent-jsonrpc',version:'1.0'}});assert(hello.result.serverInfo);
    raw.stdin!.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await send(2,'tools/list',{});assert.equal(listed.result.tools.length,8);
    const called=await send(3,'tools/call',{name:'koreai_execute',arguments:{actionId:'kakao.map.places',accountId:a.id,input:{query:'부산'},idempotencyKey:randomUUID()}});assert(!called.result.isError);await r.engine.idle();assert.equal(mock.requests.length,2);
    assert(!JSON.stringify(called).includes(fakeSecrets.restApiKey));reader.close();raw.stdin!.end();
  }finally{await transport?.close();raw?.kill();await r.close();}
});

test('imported MCP readOnlyHint never bypasses approval; schema and secret redaction apply',async()=>{
  const app=express();app.use(express.json());let count=0;
  app.post('/mcp',async(req,res)=>{
    const server=new McpServer({name:'owned-upstream',version:'1.0'});server.registerTool('echo',{description:`Echo tool ${fakeSecrets.accessToken}`,inputSchema:{message:z.string()},annotations:{readOnlyHint:true}},async({message})=>{count++;return {content:[{type:'text',text:`${message} ${fakeSecrets.accessToken}`} ]};});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);res.on('close',()=>void server.close());await transport.handleRequest(req,res,req.body);
  });
  const upstream=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const addr=upstream.address();assert(addr&&typeof addr==='object');
  const {runtime:r}=await setup();try{
    const imported=await r.remote.add({name:'My MCP',url:`http://127.0.0.1:${addr.port}/mcp`,bearerToken:fakeSecrets.accessToken,tools:['echo']});
    const a=[...r.engine.actions.values()].find(a=>a.connectorId===`mcp-${imported.id}`)!;assert.equal(a.effect,'write');assert.equal(a.origin,'user');
    assert(!a.description.includes(fakeSecrets.accessToken));assert(!JSON.stringify(imported).includes(fakeSecrets.accessToken));
    assert.throws(()=>r.engine.create(admin,{actionId:a.id,input:{message:3},idempotencyKey:randomUUID()}));
    const job=r.engine.create(admin,{actionId:a.id,input:{message:'안녕하세요'},idempotencyKey:randomUUID()});assert.equal(job.state,'pending_approval');assert.equal(count,0);
    r.engine.approve(admin,job.id,job.revision,r.engine.digest(job));await r.engine.idle();assert.equal(r.engine.get(admin,job.id).state,'succeeded',JSON.stringify(r.engine.get(admin,job.id).error));assert.equal(count,1);assert(!JSON.stringify(r.engine.get(admin,job.id)).includes(fakeSecrets.accessToken));
    await r.remote.remove(imported.id);assert.equal(r.engine.verification(a),'suspended');
  }finally{await r.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});

test('Windows DPAPI round trip preserves secrets without plaintext storage',{skip:process.platform!=='win32'},async()=>{
  const vault=new WindowsVault();const sealed=await vault.seal({accessToken:fakeSecrets.accessToken});assert(!sealed.includes(fakeSecrets.accessToken));assert.deepEqual(await vault.open(sealed),{accessToken:fakeSecrets.accessToken});
});
