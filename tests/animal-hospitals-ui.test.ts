import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { animalHospitalRegions } from '../src/research/animal-hospital-regions.js';
import { TestVault, tempDir } from './helpers.js';
import { animalHospitalMock, animalHospitalRow } from './animal-hospitals-fixture.js';

test('animal hospital mobile form syncs JSON, filters official regions and pages registration cards with original query scope',async()=>{
  const first=animalHospitalRow(),closed=animalHospitalRow(),missing=animalHospitalRow();
  first[2]='시험 하나 동물병원';closed[1]='000002';closed[2]='시험 폐업 동물병원';closed[3]='03';closed[4]='폐업';closed[5]='0003';closed[6]='폐업';closed[8]='2025-01-01';
  missing[1]='000003';missing[2]='시험 정보누락 동물병원';for(const index of [9,10,11,12,13,14,15])missing[index]='';
  const mock=animalHospitalMock([first,closed,missing]);
  const r=await createRuntime({dataDir:tempDir('animal-cards-ui'),port:0,vault:new TestVault(),bootstrapCode:'animal-cards-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${r.baseUrl}/#setup=animal-cards-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    const open=async()=>{await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'공공 동물병원 정보 확장 계획',exact:true}).getByRole('button',{name:'조회 기능 열기'}).click();};
    const results=()=>page.getByRole('region',{name:'동물병원 조회 결과'});
    await open();const execute=page.getByRole('button',{name:'실행 요청',exact:false}),region=page.getByLabel('공식 지역 필수',{exact:true});assert(await execute.isDisabled());assert.equal(await region.locator('option').count(),animalHospitalRegions.length+1);
    const regionQuery=page.getByLabel('지역 이름 검색 목록 필터',{exact:true});await regionQuery.fill('강남');await region.selectOption('서울강남구');assert(await execute.isEnabled());assert.equal(mock.calls.length,0);
    await regionQuery.fill('없는지역');await page.getByRole('status').filter({hasText:'검색된 지역이 없습니다.'}).waitFor();assert.equal(await region.inputValue(),'서울강남구');await regionQuery.fill('');
    await page.getByText('JSON 입력',{exact:true}).click();const json=page.locator('textarea.code-input');await json.fill('{bad');assert(await region.isDisabled());assert(await execute.isDisabled());
    await json.fill(JSON.stringify({region:'서울강남구',query:'시험',status:'normal',page:2,limit:1}));assert.equal(await page.getByLabel('병원명 선택 · 검색어 포함',{exact:true}).inputValue(),'시험');
    await page.getByLabel('병원명 선택 · 검색어 포함',{exact:true}).fill('시험 ');assert.equal(JSON.parse(await json.inputValue()).page,1);
    await page.getByText('JSON 입력',{exact:true}).click();await execute.click();await results().getByRole('article',{name:'시험 하나 동물병원',exact:true}).waitFor();
    const text=await results().innerText();for(const expected of ['서울강남구','인허가 상태: 영업/정상','02-000-0000','2026-10-17 22:02:00','2026-10-16 15:53:45','관리번호 001234','현재 진료·야간 응급·예약 가능 여부는 미확인','한국 시간'])assert(text.includes(expected),expected);assert.equal(await results().getByRole('article').count(),1);
    const original={...r.engine.jobs()[0]!.input};assert.equal(original.query,'시험');assert.equal(original.status,'normal');assert.equal(mock.calls.length,2);
    await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await results().getByRole('article',{name:'시험 정보누락 동물병원',exact:true}).waitFor();assert.deepEqual(r.engine.jobs()[0]!.input,{...original,page:2});assert.equal(mock.calls.length,4);assert((await results().innerText()).includes('미수집'));assert.equal(await results().getByRole('button',{name:'다음 페이지',exact:true}).count(),0);
    await page.getByRole('button',{name:'이전 페이지',exact:true}).click();await results().getByRole('article',{name:'시험 하나 동물병원',exact:true}).waitFor();assert.equal(mock.calls.length,6);
    await page.getByText('JSON 상세',{exact:true}).click();assert((await results().innerText()).includes('"latitude": null'));await page.getByText('JSON 상세',{exact:true}).click();
    await page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/animal-hospitals-cards-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'닫기',exact:true}).click();await open();await region.selectOption('서울강남구');await page.getByLabel('인허가 상태',{exact:true}).selectOption('all');await page.getByLabel('병원명 선택 · 검색어 포함',{exact:true}).fill('폐업');await page.getByLabel('병원명 선택 · 검색어 포함',{exact:true}).press('Enter');await results().getByRole('article',{name:'시험 폐업 동물병원',exact:true}).waitFor();assert((await results().innerText()).includes('2025-01-01'));assert((await results().innerText()).includes('인허가 상태: 폐업'));
    await page.getByRole('button',{name:'닫기',exact:true}).click();await open();await region.selectOption('서울종로구');await page.getByLabel('병원명 선택 · 검색어 포함',{exact:true}).fill('없는병원');await execute.click();await results().getByRole('status').filter({hasText:'기록이 없습니다.'}).waitFor();assert.equal(await results().getByRole('article').count(),0);assert.equal(r.engine.jobs()[0]!.result && (r.engine.jobs()[0]!.result as {data:{region:{name:string}}}).data.region.name,'서울종로구');
    await page.getByRole('button',{name:'닫기',exact:true}).click();await open();await region.selectOption('서울강남구');await page.getByText('페이지 설정',{exact:true}).click();await page.getByLabel('페이지',{exact:true}).fill('1001');assert(await execute.isDisabled());await page.getByLabel('페이지',{exact:true}).fill('99');await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('0');assert(await execute.isDisabled());await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('1');await execute.click();await results().getByRole('status').filter({hasText:'이 페이지에는 없습니다.'}).waitFor();await page.getByRole('button',{name:'첫 페이지',exact:true}).click();await results().getByRole('article',{name:'시험 하나 동물병원',exact:true}).waitFor();
    await page.setViewportSize({width:1280,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'닫기',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert(await page.getByText('JSON 상세',{exact:true}).evaluate(element=>element===document.activeElement));await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().verifiedServices,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();await r.close();}
});
