import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Vault } from '../src/core/security.js';
import type { Action } from '../src/types.js';

/** Test-only encryption; production has no plaintext or test-vault switch. */
export class TestVault implements Vault {
  private key=randomBytes(32);
  async seal(value:Record<string,string>){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
  async open(value:string){const b=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8'));}
}
export function tempDir(name='run'){const base=resolve(process.env.KOREAI_TEST_DATA_DIR??'.test-data');mkdirSync(base,{recursive:true,mode:0o700});return mkdtempSync(join(base,`${name}-`));}
export const fakeSecrets={clientId:'mock-client-id-12345',clientSecret:'mock-client-secret-12345',accessToken:'mock-access-token-12345',restApiKey:'mock-rest-key-12345',serviceKey:'mock-public-key-12345'};
export function secretsFor(action:Action){return Object.fromEntries(action.requiredSecrets.map(k=>[k,fakeSecrets[k as keyof typeof fakeSecrets]]));}
export function inputFor(id:string):Record<string,unknown>{
  if(id.startsWith('naver.search.')||id.startsWith('daum.')||id.startsWith('kakao.map.'))return {query:'서울 도서관'};
  if(id==='naver.cafe.join')return {clubId:'123',nickname:'코리아이'};
  if(id==='naver.cafe.publish')return {clubId:'123',menuId:'2',subject:'모임 안내',content:'토요일에 만나요'};
  if(id==='naver.calendar.create')return {title:'도서관 방문',start:'2026-10-01T10:00:00+09:00',end:'2026-10-01T11:00:00+09:00',location:'서울 도서관'};
  if(id==='band.bands')return {};
  if(id==='band.posts')return {bandKey:'band_1'};
  if(id==='band.post')return {bandKey:'band_1',postKey:'post_1'};
  if(id==='band.publish')return {bandKey:'band_1',content:'주말 모임 안내'};
  if(id==='kakao.message.self')return {text:'일정을 등록했어요',link:'https://example.com'};
  if(id==='gov.benefits.list')return {query:'청년'};
  if(id==='gov.benefits.detail')return {serviceId:'GOV-123'};
  return {};
}
export interface RequestRecord{url:URL;init:RequestInit}
export function providerMock(){
  const requests:RequestRecord[]=[];
  const fetcher:typeof fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:String(input));requests.push({url,init});
    let body:unknown;
    if(url.pathname.startsWith('/v1/search/'))body={items:[{title:'서울 도서관',link:'https://example.com'}],total:1};
    else if(url.pathname.includes('/cafe/'))body={message:{status:'200',result:{articleId:4,articleUrl:'https://cafe.naver.com/example/4'}}};
    else if(url.pathname.includes('createSchedule')){
      const form=new URLSearchParams(String(init.body));const uid=form.get('scheduleIcalString')?.match(/UID:([^\r\n]+)/)?.[1];
      body={result:'success',returnValue:{processType:'create',calendarId:'123',icalUid:uid}};
    }
    else if(url.hostname==='openapi.band.us')body={result_code:1,result_data:{items:[{content:'모임은 토요일입니다.',post_key:'post_1'}],bands:[{band_key:'band_1',name:'동네 모임'}],band_key:'band_1',post_key:'post_1',paging:{next_params:{after:'next',access_token:fakeSecrets.accessToken}}}};
    else if(url.hostname==='kapi.kakao.com')body={result_code:0};
    else if(url.hostname==='dapi.kakao.com')body={documents:[{place_name:'서울 도서관',x:'126.97',y:'37.56'}],meta:{total_count:1}};
    else if(url.hostname==='api.odcloud.kr')body={data:[{서비스ID:'GOV-123',서비스명:'청년 지원'}],totalCount:1};
    else if(url.pathname.endsWith('/getUltraSrtNcst'))body={
      response:{header:{resultCode:'00',resultMsg:'OK'},body:{
        pageNo:Number(url.searchParams.get('pageNo')),numOfRows:Number(url.searchParams.get('numOfRows')),totalCount:1,
        items:{item:[{baseDate:url.searchParams.get('base_date'),baseTime:url.searchParams.get('base_time'),nx:Number(url.searchParams.get('nx')),ny:Number(url.searchParams.get('ny')),category:'T1H',obsrValue:'21.5'}]},
      }},
    };
    else throw new Error('Unexpected provider endpoint');
    return Response.json(body);
  };
  return {requests,fetcher};
}
