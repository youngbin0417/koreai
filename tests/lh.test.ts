import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lhAction as action, lhSchema, lhExample, lhRegions, lhNoticeTypes, lhRequestTemplate, lhExecutor } from '../src/connectors/lh.js';
import { createRuntime } from '../src/http.js';
import { ActionError, type ExecutionContext } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';
import { runtimeApi, runtimeLogin } from './mcp-oauth-fixture.js';

const secret='unit-lh-private-key+/=%&';
const input={postedFrom:'2026-10-01',postedTo:'2026-10-20',noticeType:'06',regionCode:'36110',status:'접수중',name:'세종 & 행복'};
const row=()=>({PAN_ID:'0000061060',UPP_AIS_TP_CD:'06',AIS_TP_CD:'07',SPL_INF_TP_CD:'050',CCR_CNNT_SYS_DS_CD:'02',RNUM:'1',PAN_NM:'세종 & 행복 공고',UPP_AIS_TP_NM:'임대주택',AIS_TP_CD_NM:'행복주택',CNP_CD_NM:'세종특별자치시',PAN_SS:'접수중',PAN_NT_ST_DT:'2026.10.01',CLSG_DT:'2026.10.31',PAN_DT:'20260930',DTL_URL:' https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancInfo.do?panId=0000061060&ccrCnntSysDsCd=02&uppAisTpCd=06&aisTpCd=07',DTL_URL_MOB:'https://apply.lh.or.kr/LH/index.html?gv_url=SIL::CLCC_SIL_0050.xfdl&gv_param=CCR_CNNT_SYS_DS_CD:02,PAN_ID:0000061060,LCC:Y'});
const reply=(rows:Record<string,unknown>[]=[row()],total=rows.length,values:Record<string,unknown>=input)=>{
  const parsed=lhSchema.parse(values);return JSON.stringify([{dsSch:[{PAGE:String(parsed.page),PG_SZ:String(parsed.limit),PAN_ST_DT:parsed.postedFrom.replaceAll('-',''),PAN_ED_DT:parsed.postedTo.replaceAll('-','')}]},{resHeader:[{SS_CODE:'Y',RS_DTTM:'20261020120000'}],dsList:rows.map(row=>({ALL_CNT:String(total),...row}))}]);
};
function context(values:Record<string,unknown>=input,controller=new AbortController()){
  let dispatched=0;const now=new Date().toISOString();
  const ctx:ExecutionContext={job:{id:randomUUID(),clientId:'local-admin',actionId:action.id,input:values,idempotencyKey:randomUUID(),requestHash:'test',effect:'read',state:'running',revision:1,dispatched:false,createdAt:now,updatedAt:now,interventions:0,events:[]},secrets:{serviceKey:secret},signal:controller.signal,dispatch(){dispatched++;}};
  return{ctx,dispatched:()=>dispatched};
}
const execute=async(body=reply(),values:Record<string,unknown>=input)=>(await lhExecutor(async()=>new Response(body))(action,context(values).ctx)).data as Record<string,any>;
const hasCode=(code:string,state='failed')=>(error:unknown)=>error instanceof ActionError && error.code===code && error.state===state && !error.message.includes(secret);

test('LH validates its published region/type/state snapshots, real date ranges and bounded inputs without accepting old portal names or identities',()=>{
  assert.equal(Object.keys(lhRegions).length,16);assert.equal(Object.keys(lhNoticeTypes).length,6);assert(lhSchema.safeParse(input).success);assert(lhSchema.safeParse({postedFrom:'2024-02-29',postedTo:'2024-03-01',regionCode:'12',closingFrom:'2024-03-01'}).success);
  for(const patch of [{postedFrom:'2026-02-29'},{postedTo:'2026-09-30'},{closingFrom:'2026-11-01',closingTo:'2026-10-31'},{regionCode:'36'},{regionCode:'29'},{regionCode:'110000'},{regionCode:36110},{noticeType:'6'},{status:'접수가능'},{page:1001},{limit:101},{name:''},{name:'가'.repeat(51)},{PAN_NT_ST_DT:'2026.10.01'},{ServiceKey:secret},{url:'http://localhost'},{residentNumber:'private'}])assert(!lhSchema.safeParse({...input,...patch}).success,JSON.stringify(patch));
  const example=lhExample(new Date('2026-12-31T15:00:00Z'));assert.equal(example.postedTo,'2027-01-01');assert.equal(example.postedFrom,'2026-12-02');assert.equal(lhExample(new Date('2026-12-31T14:59:59Z')).postedTo,'2026-12-31');
});

test('LH uses the current guide date names, exact region strings and one encoded serviceKey on a fixed HTTPS operation',async()=>{
  const values={...input,closingFrom:'2026-10-20',closingTo:'2026-11-30'},template=lhRequestTemplate(values);
  assert.equal(template.endpoint,'https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1');assert(!('serviceKey'in template.query));assert(!('PAN_NT_ST_DT'in template.query));assert(!('CLSG_DT'in template.query));assert(!JSON.stringify(template).includes(secret));
  assert.deepEqual(template.query,{PG_SZ:10,PAGE:1,PAN_ST_DT:'20261001',PAN_ED_DT:'20261020',CLSG_ST_DT:'20261020',CLSG_ED_DT:'20261130',PAN_NM:input.name,UPP_AIS_TP_CD:'06',CNP_CD:'36110',PAN_SS:'접수중'});
  let calls=0;const run=context(values);await lhExecutor(async(address,init)=>{calls++;const url=new URL(String(address));assert.equal(url.origin,'https://apis.data.go.kr');assert.equal(url.searchParams.get('serviceKey'),secret);assert.equal(url.searchParams.get('PAN_NM'),input.name);assert.equal(url.searchParams.get('CNP_CD'),'36110');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');return new Response(reply());})(action,run.ctx);assert.equal(calls,1);assert.equal(run.dispatched(),1);
});

test('LH preserves compound notice references, three date meanings, output timestamp and unknown eligibility',async()=>{
  const result=await execute(),notice=result.notices[0];assert.equal(notice.noticeId,'0000061060');assert.equal(notice.reference.supplyInfoTypeCode,'050');assert.equal(notice.noticeKey,'02:0000061060:06:07:050');assert.equal(notice.publishedOn,'2026-10-01');assert.equal(notice.closingOn,'2026-10-31');assert.equal(notice.announcementOn,'2026-09-30');assert.equal(notice.publishedOnRaw,'2026.10.01');assert.equal(notice.regionNameRaw,'세종특별자치시');assert.equal(notice.statusRaw,'접수중');
  assert.equal(notice.currentlyAcceptingApplications,null);assert.equal(notice.userEligible,null);assert.equal(notice.applicationSubmitted,null);assert.equal(result.providerOutputAtRaw,'20261020120000');assert.equal(result.providerUpdatedAt,null);assert(result.source.attribution.includes('한국토지주택공사'));assert.equal(notice.detailLinks.desktop.check,'matched_reference');assert.equal(notice.detailLinks.mobile.check,'matched_reference');
});

test('LH verifies modern and legacy link references and omits mismatched, ambiguous, unsafe or unverified destinations without fetching them',async()=>{
  const modern=row().DTL_URL.trim(),legacy=row().DTL_URL_MOB;
  for(const[url,check]of [[modern.replace('panId=0000061060','panId=999'),'mismatched_reference'],[modern.replace('ccrCnntSysDsCd=02','ccrCnntSysDsCd=03'),'mismatched_reference'],[modern.replace('aisTpCd=07','aisTpCd=99'),'mismatched_reference'],[legacy.replace('PAN_ID:0000061060','PAN_ID:999'),'mismatched_reference'],[modern+'&panId=0000061060','rejected_url'],[modern.replace('&ccrCnntSysDsCd=02',''),'unverified_reference'],['https://apply.lh.or.kr/other','rejected_url'],['https://apply.lh.or.kr.evil.example/','rejected_url'],[modern.replace('https://','http://'),'rejected_url'],[modern.replace('https://','https://user:pass@'),'rejected_url'],['javascript:alert(1)','rejected_url'],['','missing']]){
    const result=await execute(reply([{...row(),DTL_URL:url}]));assert.deepEqual(result.notices[0].detailLinks.desktop,{url:null,check});
  }
});

test('LH allows the same PAN_ID in different systems, retains correct page totals and leaves empty-page totals unknown',async()=>{
  const values={...input,limit:2},rows=[row(),{...row(),CCR_CNNT_SYS_DS_CD:'03',RNUM:'2'}];const result=await execute(reply(rows,7,values),values);assert.equal(result.notices.length,2);assert.notEqual(result.notices[0].noticeKey,result.notices[1].noticeKey);assert.equal(result.pagination.totalCount,7);assert.equal(result.pagination.nextPage,2);
  const finalInput={...input,page:2},last=await execute(reply([{...row(),RNUM:'11'}],11,finalInput),finalInput);assert.equal(last.pagination.nextPage,null);assert.equal(last.pagination.totalCount,11);
  const empty=await execute(reply([],0));assert.equal(empty.status,'no_data');assert.equal(empty.pagination.totalCount,null);assert.equal(empty.pagination.nextPage,null);assert.deepEqual(empty.notices,[]);
});

test('LH retains non-date deadline guidance, absent announcement dates and nationwide region labels without inventing filter matches',async()=>{
  const result=await execute(reply([{...row(),CNP_CD_NM:'전국',CLSG_DT:'상시',PAN_DT:'',PAN_SS:'공급자 새 상태'}]),{postedFrom:input.postedFrom,postedTo:input.postedTo,regionCode:'11'});const notice=result.notices[0];assert.equal(notice.closingOnRaw,'상시');assert.equal(notice.closingOn,null);assert.equal(notice.announcementOn,null);assert.equal(notice.regionNameRaw,'전국');assert.equal(notice.statusRaw,'공급자 새 상태');
  await assert.rejects(()=>execute(reply([{...row(),PAN_NT_ST_DT:'2026.02.29'}])),hasCode('INVALID_RESPONSE'));
});

test('LH rejects changed envelopes, failed headers, conflicting page echoes, row numbering, counts, types and states',async()=>{
  const base=JSON.parse(reply());const mutate=(fn:(value:any)=>void)=>{const value=structuredClone(base);fn(value);return JSON.stringify(value);};
  for(const raw of ['{}','[]','{',JSON.stringify([{resHeader:[{SS_CODE:'Y'}]}]),mutate(v=>v[1].resHeader.push({SS_CODE:'Y'})),mutate(v=>v[0].dsSch[0].PAGE='2'),mutate(v=>v[0].dsSch[0].PG_SZ='20'),mutate(v=>v[0].dsSch[0].PAN_ST_DT='20260901'),reply([{...row(),ALL_CNT:'0'}]),reply([{...row(),RNUM:'2'}]),reply([row(),{...row(),RNUM:'2'}],2),reply([{...row(),PAN_ID:'../other'}]),reply([{...row(),UPP_AIS_TP_CD:'05'}]),reply([{...row(),PAN_SS:'접수마감'}])])await assert.rejects(()=>execute(raw),hasCode('INVALID_RESPONSE'));
  await assert.rejects(()=>execute(JSON.stringify([{resHeader:[{SS_CODE:'N',RS_DTTM:secret}]}])),hasCode('PROVIDER_REJECTED'));
  await assert.rejects(()=>execute(reply([row(),{...row(),PAN_ID:'0002',RNUM:'2',ALL_CNT:'3'}],2)),hasCode('INVALID_RESPONSE'));
});

test('LH recognizes HTTP-200 JSON/XML gateway authentication, quota and IP errors without echoing provider messages',async()=>{
  for(const code of ['20','21','30','31','32','33']){
    await assert.rejects(()=>execute(JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:code,errMsg:secret}}})),hasCode('AUTH_REQUIRED','awaiting_auth'));
    await assert.rejects(()=>execute(`<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`),hasCode('AUTH_REQUIRED','awaiting_auth'));
  }
  for(const[code,error]of [['22','PROVIDER_RATE_LIMIT'],['23','PROVIDER_RATE_LIMIT'],['29','PROVIDER_ACCESS_BLOCKED'],['99','PROVIDER_99']])await assert.rejects(()=>execute(JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:code}}})),hasCode(error));
});

test('LH refuses missing keys, handles HTTP/network/timeout faults and cancels before or during dispatch',async()=>{
  for(const[status,code,state]of [[401,'AUTH_REQUIRED','awaiting_auth'],[403,'AUTH_REQUIRED','awaiting_auth'],[429,'PROVIDER_RATE_LIMIT','failed'],[503,'PROVIDER_HTTP_503','failed']]as const)await assert.rejects(()=>lhExecutor(async()=>new Response(secret,{status}))(action,context().ctx),hasCode(code,state));
  for(const key of ['', 'bad\nkey']){const run=context();run.ctx.secrets.serviceKey=key;await assert.rejects(()=>lhExecutor()(action,run.ctx),hasCode('AUTH_REQUIRED','awaiting_auth'));assert.equal(run.dispatched(),0);}
  await assert.rejects(()=>lhExecutor(async()=>{throw Error(`https://other.example/?serviceKey=${secret}`);})(action,context().ctx),hasCode('PROVIDER_CONNECTION_ERROR'));await assert.rejects(()=>lhExecutor(async()=>{throw new DOMException(secret,'TimeoutError');})(action,context().ctx),hasCode('PROVIDER_TIMEOUT'));
  const before=new AbortController(),run=context(input,before);before.abort();await assert.rejects(()=>lhExecutor()(action,run.ctx),hasCode('CANCELLED','cancelled'));assert.equal(run.dispatched(),0);
  const during=new AbortController();await assert.rejects(()=>lhExecutor(async()=>{during.abort();throw Error(secret);})(action,context(input,during).ctx),hasCode('CANCELLED','cancelled'));
  await assert.rejects(()=>lhExecutor()({...action,id:'lh.applications.submit'},context().ctx),hasCode('NOT_IMPLEMENTED'));
});

test('LH bounds response streams, rejects invalid UTF-8 and refuses XML data/DTD payloads',async()=>{
  let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});await assert.rejects(()=>lhExecutor(async()=>new Response(stream))(action,context().ctx),hasCode('RESULT_TOO_LARGE'));assert.equal(cancelled,true);
  await assert.rejects(()=>lhExecutor(async()=>new Response(new Uint8Array([0xff])))(action,context().ctx),hasCode('INVALID_RESPONSE'));
  for(const raw of ['<html>login</html>','<response><data/></response>','<!DOCTYPE response [<!ENTITY x "boom">]><response/>'])await assert.rejects(()=>execute(raw),hasCode('INVALID_RESPONSE'));
});

test('LH HTTP scopes its separate account, previews without calls, deduplicates and resumes authentication with no support evidence',async()=>{
  let calls=0,denied=false;const r=await createRuntime({dataDir:tempDir('lh-http'),port:0,vault:new TestVault(),evidenceMode:'mock',fetcher:async()=>{calls++;return new Response(denied?JSON.stringify({OpenAPI_ServiceResponse:{cmmMsgHeader:{returnReasonCode:'30',errMsg:secret}}}):reply());}});
  try{
    const cookie=await runtimeLogin(r),api=(path:string,method='GET',body?:unknown,bearer?:string)=>runtimeApi(r,`/api${path}`,method,body,cookie,bearer?{Authorization:`Bearer ${bearer}`}:{ });const preview=await(await api(`/drafts/${action.id}/preview`,'POST',lhExample())).json();assert.equal(preview.networkDispatched,false);assert.equal(preview.request.authentication.queryParameter,'serviceKey');assert.equal(preview.request.query.serviceKey,undefined);assert.equal(calls,0);
    const request={actionId:action.id,input,accountId:'',idempotencyKey:randomUUID()},wrong=await r.engine.saveAccount({label:'TourAPI 시험',credentialType:'tourapi-api',allowedActions:['tourapi.regions.list'],secrets:{serviceKey:secret}});request.accountId=wrong.id;assert.equal((await(await api('/jobs','POST',request)).json()).error.code,'ACCOUNT_REQUIRED');
    const account=await r.engine.saveAccount({label:'LH 시험',credentialType:'lh-api',allowedActions:[action.id],secrets:{serviceKey:secret}});request.accountId=account.id;const client=r.engine.createClient({name:'LH reader',allowedActions:[action.id],allowedAccountIds:[account.id]});
    for(const limits of [{allowedActions:[action.id],allowedAccountIds:[]},{allowedActions:['tourapi.regions.list'],allowedAccountIds:[account.id]}]){const blocked=r.engine.createClient({name:'blocked',...limits});assert.equal((await api('/jobs','POST',request,blocked.token)).status,403);}
    const response=await api('/jobs','POST',request,client.token);assert.equal(response.status,202);const job=await response.json();await r.engine.idle();const result=await(await api(`/jobs/${job.id}`,'GET',undefined,client.token)).json();assert.equal(result.state,'succeeded');assert.equal(result.result.contentTrust,'external_data');assert.equal(result.result.data.notices[0].userEligible,null);assert(!JSON.stringify(result).includes(secret));
    const duplicate=await(await api('/jobs','POST',request,client.token)).json();await r.engine.idle();assert.equal(duplicate.id,job.id);assert.equal(calls,1);
    denied=true;const pending=await(await api('/jobs','POST',{...request,idempotencyKey:randomUUID()},client.token)).json();await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'awaiting_auth');denied=false;await api(`/jobs/${pending.id}/resume`,'POST',{},client.token);await r.engine.idle();assert.equal((await(await api(`/jobs/${pending.id}`,'GET',undefined,client.token)).json()).state,'succeeded');assert.equal(calls,3);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await r.close();}
});
