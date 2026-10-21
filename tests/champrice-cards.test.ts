import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChampriceResult } from '../ui/Champrice.js';
import { normalizeChampriceCsv } from '../src/connectors/champrice.js';
import { champriceBytes, champriceCsv, champriceRow } from './champrice-fixture.js';

const render = (result: unknown) => renderToStaticMarkup(createElement(ChampriceResult, { result, busy: false, onPage: () => { throw Error('render must not execute'); } }));
function result() {
  const row=champriceRow();row[0]='우유 <script>alert(1)</script>';row[2]='0000';row[5]='';row[6]='N';
  return {contentTrust:'external_data',data:normalizeChampriceCsv(champriceBytes(champriceCsv([row])),{productName:'우유'})};
}

test('Champrice cards escape external text, keep zero/unknown and old results, and use reviewed source links',()=>{
  const value=result();
  const html=render({...value,data:{...value.data,source:{...value.data.source,snapshotUrl:'javascript:alert(1)'}}});
  for(const expected of ['0원','미수집','N · 없음','기록 없음','&lt;script&gt;','JSON 상세','한국소비자원'])assert(html.includes(expected),expected);
  assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(html.includes('href="https://www.data.go.kr/'));
  assert(!html.includes('1위'));assert(!html.includes('가장 저렴'));
});

test('Champrice historical malformed results fall back to escaped JSON without breaking the job dialog',()=>{
  const value=result();
  for(const data of [null,{...value.data,prices:null},{...value.data,prices:[{...value.data.prices[0],surveyedOn:'2026-99-99'}]},{...value.data,cache:{status:{unsafe:true}}}]){
    const html=render({contentTrust:'external_data',data});assert(html.includes('카드로 표시할 수 없습니다.'));assert(html.includes('JSON 상세'));assert(!html.includes('<script>'));
  }
  const legacy={...value,data:{...value.data,retrievedAt:'not-a-date'}};
  assert(render(legacy).includes('기록 없음'));
  for(const status of ['__proto__','constructor','future-status'])assert(render({...value,data:{...value.data,cache:{status}}}).includes('기록 확인 필요'));
});
