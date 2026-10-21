import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimalHospitalsResult } from '../ui/AnimalHospitals.js';
import { normalizeAnimalHospitalCsv } from '../src/connectors/animal-hospitals.js';
import { animalHospitalBytes, animalHospitalRow } from './animal-hospitals-fixture.js';

const render = (result: unknown) => renderToStaticMarkup(createElement(AnimalHospitalsResult,{result,busy:false,onPage:()=>{throw Error('render must not execute');}}));
function result() {
  const row = animalHospitalRow();row[2] = '시험 <script>alert(1)</script> 동물병원';row[11] = '';row[12] = '';
  return {contentTrust:'external_data',data:normalizeAnimalHospitalCsv(animalHospitalBytes([row]),{region:'서울강남구'})};
}

test('animal hospital cards preserve registration, raw timestamps and missing values without trusting links or coordinates',()=>{
  const value=result();
  const html=render({...value,data:{...value.data,source:{...value.data.source,url:'javascript:alert(1)',downloadUrl:'https://private.example/redirect'},retrievedAt:'not-a-date'}});
  for(const expected of ['001234','영업/정상','미수집','2026-10-16 15:53:45','기록 없음','현재 진료·야간 응급·예약 가능 여부는 미확인','&lt;script&gt;','EPSG:5174','JSON 상세'])assert(html.includes(expected),expected);
  assert(!html.includes('<script>'));assert(!html.includes('href="javascript:'));assert(!html.includes('href="https://private.example'));assert(!html.includes('maps.google'));
  assert(html.includes('href="https://www.data.go.kr/data/15045050/fileData.do"'));
});

test('animal hospital cards keep old or malformed results readable and bound pagination to supported pages',()=>{
  const value=result();
  for(const data of [null,{...value.data,region:{name:'서울강남구',code:'other'}},{...value.data,hospitals:null},{...value.data,hospitals:[{...value.data.hospitals[0],registration:null}]}]){
    const html=render({contentTrust:'external_data',data});assert(html.includes('카드로 표시할 수 없습니다.'));assert(html.includes('JSON 상세'));assert(!html.includes('<script>'));
  }
  const old={...value,data:{...value.data,retrievedAt:undefined}};assert(render(old).includes('기록 없음'));
  const last=render({...value,data:{...value.data,pagination:{page:1000,limit:1,hasMore:true}}});assert(last.includes('조회 가능한 마지막 페이지'));assert(!last.includes('>다음 페이지<'));
});
