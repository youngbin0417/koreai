import assert from 'node:assert/strict';
import { tmapEndpoint } from '../src/connectors/tmap.js';
export const tmapSecret='unit-tmap-private-key';
export const tmapPayload=(patch:Record<string,unknown>={})=>({type:'FeatureCollection',features:[{type:'Feature',properties:{totalDistance:12500,totalTime:1850,totalFare:0,taxiFare:18000,...patch}}]});
export function tmapMock(){const calls:{url:string;body:URLSearchParams}[]=[];const flags={status:200,invalidUtf8:false,oversized:false,error:false,zero:false};
  const fetcher:typeof fetch=async(address,init)=>{const url=new URL(String(address));assert.equal(url.origin+url.pathname,tmapEndpoint);assert.equal(url.search,'?version=1');assert.equal(init?.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');const headers=new Headers(init.headers);assert.equal(headers.get('appKey'),tmapSecret);assert.equal(headers.get('content-type'),'application/x-www-form-urlencoded');assert.equal(headers.get('Authorization'),null);const body=new URLSearchParams(String(init.body));assert.equal(body.get('totalValue'),'2');assert.equal(body.get('carType'),'0');assert.equal(body.get('reqCoordType'),'WGS84GEO');calls.push({url:url.href,body});
    if(flags.status!==200)return new Response(flags.status===204?null:tmapSecret,{status:flags.status});
    if(flags.invalidUtf8)return new Response(new Uint8Array([0xff]));if(flags.oversized)return new Response('x'.repeat(256001));
    return Response.json(flags.error?{error:{id:'unit',message:tmapSecret}}:tmapPayload(flags.zero?{totalTime:0}:{}));
  };return{calls,flags,fetcher};}
