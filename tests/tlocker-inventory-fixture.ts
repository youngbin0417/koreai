import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { tlockerInventorySnapshot } from '../src/research/tlocker-inventory.js';

export const lockerHeaders=['연번','호선','보관함명','소형','중형','대형','열'];
export const lockerRows=[['1','1','서울역1~22','12','4','6','6'],['2','1','서울역23~44','12','4','0','4'],['3','4','서울역29~44','18','4','6','7'],['4','식물원','식물원1~14','9','4','1','3']];
export function lockerCsv(rows=lockerRows,headers=lockerHeaders){const quote=(s:string)=>/[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;return[headers,...rows].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';}
export const lockerBytes=(text=lockerCsv())=>iconv.encode(text,'cp949');
export function lockerMock(){
  const calls:{url:URL;init:RequestInit}[]=[],flags={status:200,html:false,body:lockerCsv()};
  const fetcher:typeof fetch=async(input,init={})=>{const url=new URL(input instanceof Request?input.url:String(input));calls.push({url,init});assert.equal(url.origin+url.pathname,tlockerInventorySnapshot.endpoint);assert.deepEqual(Object.fromEntries(url.searchParams),tlockerInventorySnapshot.query);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert(!new Headers(init.headers).has('authorization'));return new Response(flags.html?'<html>private-upstream-error</html>':new Uint8Array(lockerBytes(flags.body)),{status:flags.status,headers:{'Content-Type':flags.html?'text/html':'application/octet-stream; charset=UTF-8','Last-Modified':'Tue, 06 Oct 2026 00:00:00 GMT'}});};
  return{calls,flags,fetcher};
}
