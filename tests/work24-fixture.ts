import assert from 'node:assert/strict';
import { work24Endpoint } from '../src/connectors/work24.js';

export const work24Secret='unit-work24-private-key+/%';
export const work24AccessError='<GO24><error>신청하신 OpenApi 서비스가 존재하지 않습니다</error></GO24>';
const escape=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export function work24Row(patch:Record<string,string>={}) {
  const row={wantedAuthNo:'K000000001',company:'시험 & 회사',title:'개발자 모집',region:'서울 시험구',salTpNm:'월급',sal:'250만원 ~ 300만원',minSal:'002500000',maxSal:'3000000',holidayTpNm:'주 5일 근무',minEdubg:'학력무관',career:'관계없음',regDt:'26-10-20',closeDt:'채용시까지',infoSvc:'고용24',empTpCd:'10',jobsCd:'001234',smodifyDtm:'20261021120000',wantedInfoUrl:'https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=K000000001',busino:'private-business-number',basicAddr:'private-address',detailAddr:'private-detail-address',...patch};
  return '<wanted>'+Object.entries(row).map(([k,v])=>`<${k}>${escape(v)}</${k}>`).join('')+'</wanted>';
}
export function work24Xml(rows=[work24Row()],patch:Record<string,string|number>={}) {
  const fields={total:rows.length,startPage:1,display:10,...patch};
  return '<?xml version="1.0" encoding="UTF-8"?><wantedRoot>'+Object.entries(fields).map(([k,v])=>`<${k}>${v}</${k}>`).join('')+rows.join('')+'</wantedRoot>';
}
export function work24Mock() {
  const calls:URL[]=[];const flags={status:200,body:null as string|null,invalidUtf8:false,oversized:false};
  const fetcher:typeof fetch=async(address,init)=>{
    const url=new URL(String(address));assert.equal(url.origin+url.pathname,work24Endpoint);assert.equal(url.searchParams.get('authKey'),work24Secret);assert.equal(url.searchParams.getAll('authKey').length,1);
    assert.equal(url.searchParams.get('callTp'),'L');assert.equal(url.searchParams.get('returnType'),'XML');assert.equal(url.searchParams.get('sortOrderBy'),'DESC');assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);assert.equal(new Headers(init.headers).get('Authorization'),null);calls.push(url);
    if(flags.status!==200)return new Response(flags.status===204?null:work24Secret,{status:flags.status});
    if(flags.invalidUtf8)return new Response(new Uint8Array([0xff]));if(flags.oversized)return new Response('x'.repeat(2_000_001));
    return new Response(flags.body??work24Xml([work24Row()],{startPage:url.searchParams.get('startPage')!,display:url.searchParams.get('display')!}),{headers:{'Content-Type':'application/xml;charset=UTF-8'}});
  };return{calls,flags,fetcher};
}
