import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyWork24Region } from '../ui/work24-model.js';
import { Work24Form } from '../ui/Work24.js';
import { Work24RegionsResult } from '../ui/Work24Regions.js';
import { normalizeWork24Regions } from '../src/connectors/work24-regions.js';
import { work24RegionsXml } from './work24-fixture.js';

test('Work24 region application preserves draft filters, resets the page and keeps source metadata outside the API input',()=>{
  const region={code:'11680',name:'강남구',parentName:'서울',retrievedAt:'2026-10-21T15:00:00.000Z'};
  const input=JSON.parse(applyWork24Region(JSON.stringify({keyword:'개발자',regionCode:'00000',employmentType:'11',page:8,limit:25}),region));
  assert.deepEqual(input,{keyword:'개발자',regionCode:'11680',employmentType:'11',page:1,limit:25});
  for(const raw of ['{bad','null','[]'])assert.throws(()=>applyWork24Region(raw,region));
  assert.throws(()=>applyWork24Region('{}',{...region,code:'bad'}));
  const props={input:JSON.stringify(input),changeInput:()=>{},busy:false,submit:()=>{},regionSelection:region};
  const html=renderToStaticMarkup(createElement(Work24Form,props));for(const text of ['API 선택','강남구','공통코드 API에서 선택','한국 시간','정적 XLS 코드표와 별도 자료'])assert(html.includes(text),text);
  const changed=renderToStaticMarkup(createElement(Work24Form,{...props,input:JSON.stringify({...input,regionCode:'11000'})}));assert(!changed.includes('공통코드 API에서 선택'));
  const unknown=renderToStaticMarkup(createElement(Work24Form,{...props,input:JSON.stringify({...input,regionCode:'99999'}),regionSelection:{...region,code:'99999',name:'새 지역 <script>'}}));assert(unknown.includes('API 선택'));assert(unknown.includes('&lt;script&gt;'));assert(!unknown.includes('JSON에 입력한 지역 코드는 검토한 목록에 없습니다.'));
});

test('Work24 region cards offer only an explicit draft selection and disable it while busy',()=>{
  const props={result:{contentTrust:'external_data',data:normalizeWork24Regions(work24RegionsXml())},busy:false,onPage:()=>{}};
  assert(!renderToStaticMarkup(createElement(Work24RegionsResult,props)).includes('조건 채우기'));
  const html=renderToStaticMarkup(createElement(Work24RegionsResult,{...props,busy:true,onUseRegion:()=>{throw Error('must require click');}}));assert.equal((html.match(/조건 채우기/g)||[]).length,3);assert.equal((html.match(/type="button" disabled/g)||[]).length,3);
});
