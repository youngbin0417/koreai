import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { champriceSnapshot } from '../src/connectors/champrice.js';
export const champriceHeaders=['상품명','조사일','판매가격','판매업소','제조사','세일여부','원플러스원'];
export const champriceRow=()=>['시험 우유(1L)','2026-09-25','2590','시험마트 서울점','시험제조사','','N'];
const escape=(value:string)=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
export const champriceCsv=(rows=[champriceRow()],headers=champriceHeaders)=>[headers,...rows].map(row=>row.map(escape).join(',')).join('\r\n')+'\r\n';
export const champriceBytes=(text=champriceCsv())=>new Uint8Array(iconv.encode(text,'cp949'));
export function champriceMock(){
  const calls:URL[]=[];const flags={status:200,html:false,text:champriceCsv()};
  const fetcher:typeof fetch=async(address,init)=>{
    const url=new URL(String(address));assert.equal(url.origin+url.pathname,champriceSnapshot.endpoint);assert.deepEqual(Object.fromEntries(url.searchParams),champriceSnapshot.query);assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);const headers=new Headers(init.headers);assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('Cookie'),null);calls.push(url);
    if(flags.status!==200)return new Response('private-upstream-error',{status:flags.status});
    return new Response(flags.html?'<html>private-upstream-error</html>':champriceBytes(flags.text),{headers:{'Content-Type':flags.html?'text/html':'application/octet-stream; charset=UTF-8'}});
  };return{calls,flags,fetcher};
}
