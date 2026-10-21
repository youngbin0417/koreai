import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Work24Result } from '../ui/Work24.js';
import { normalizeWork24Response } from '../src/connectors/work24.js';
import { work24Row, work24Xml } from './work24-fixture.js';

const render = (result: unknown) => renderToStaticMarkup(createElement(Work24Result,{result,busy:false,onPage:()=>{throw Error('render must not execute');}}));
const result = () => ({contentTrust:'external_data',data:normalizeWork24Response(work24Xml([work24Row({title:'개발자 <script>alert(1)</script>',sal:'0',minSal:'0000',maxSal:'',closeDt:'채용시까지'})]),{keyword:'개발자'})});

test('Work24 cards escape external text, retain zero and raw salary/deadline, and recheck official job links',()=>{
  const value=result(),html=render(value);
  for(const expected of ['&lt;script&gt;','>0<','0000','미제공','채용시까지','현재 모집 중인지','JSON 상세'])assert(html.includes(expected),expected);
  assert(html.includes('class="work24-job-link"'));assert(!html.includes('<script>'));
  const badLinks=['javascript:alert(1)','http://www.work24.go.kr/?wantedAuthNo=K000000001','https://private.example/?wantedAuthNo=K000000001','https://www.work24.go.kr/?wantedAuthNo=other','https://www.work24.go.kr/?wantedAuthNo=K000000001&authKey=private','https://www.work24.go.kr/?wantedAuthNo=K000000001&wantedAuthNo=K000000001'];
  for(const url of badLinks){const output=render({...value,data:{...value.data,jobs:[{...value.data.jobs[0],url,sourceLinkVerified:true}]}});assert(!output.includes('class="work24-job-link"'));assert(output.includes('확인된 공식 공고 링크가 없습니다.'));}
  const unverified=render({...value,data:{...value.data,jobs:[{...value.data.jobs[0],sourceLinkVerified:false}]}});assert(!unverified.includes('class="work24-job-link"'));
  const partial=normalizeWork24Response(work24Xml([work24Row()],{total:3,display:2}),{keyword:'개발자',limit:2});assert(render({contentTrust:'external_data',data:partial}).includes('뒤에 결과가 남아 있습니다.'));
  const last=normalizeWork24Response(work24Xml([work24Row()],{total:1001,startPage:1000,display:1}),{keyword:'개발자',page:1000,limit:1});const lastHtml=render({contentTrust:'external_data',data:last});assert(lastHtml.includes('조회 가능한 마지막 페이지'));assert(!lastHtml.includes('>다음 페이지<'));
});

test('Work24 historical malformed results retain escaped JSON and never invent query timestamps',()=>{
  const value=result();
  for(const data of [null,{...value.data,jobs:null},{...value.data,jobs:[{...value.data.jobs[0],salary:null}]},{...value.data,jobs:[{...value.data.jobs[0],company:{unsafe:true}}]}]){
    const html=render({contentTrust:'external_data',data});assert(html.includes('카드로 표시할 수 없습니다.'));assert(html.includes('JSON 상세'));assert(!html.includes('<script>'));
  }
  for(const retrievedAt of [undefined,'not-a-date'])assert(render({...value,data:{...value.data,retrievedAt}}).includes('기록 없음'));
});
