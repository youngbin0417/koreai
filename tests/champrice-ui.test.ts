import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { champriceMock, champriceCsv, champriceRow } from './champrice-fixture.js';

test('Champrice mobile UI selects reviewed months, clears conflicting dates and reuses a verified file without an account',async()=>{
  const mock=champriceMock(),r=await createRuntime({dataDir:tempDir('champrice-ui'),port:0,vault:new TestVault(),bootstrapCode:'champrice-ui-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${r.baseUrl}/#setup=champrice-ui-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click();const card=page.getByRole('article',{name:'참가격 확장 계획',exact:true});assert((await card.innerText()).includes('키 없이 조회'));await card.getByRole('button',{name:'조회 기능 열기'}).click();assert((await page.getByRole('dialog').innerText()).includes('2026년 9월'));assert((await page.getByRole('dialog').innerText()).includes('실시간 판매가'));
    await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('productName'));await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();const preview=await page.locator('.draft-inspector pre').innerText();assert(preview.includes('"type": "none"'));assert(preview.includes('"month": "2026-09"'));assert(preview.includes('localFilter'));assert.equal(mock.calls.length,0);
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();const result=await page.getByRole('dialog').innerText();for(const expected of ['시험 우유(1L)','2,590원','미수집','N · 없음','2026년 9월 조사','다운로드·검증','이번 조회','한국 시간','새 파일 다운로드'])assert(result.includes(expected),expected);await page.getByText('JSON 상세',{exact:true}).click();const json=await page.getByRole('dialog').innerText();for(const expected of ['"priceKrw": 2590','"sale": null','"onePlusOne": false','"currentPriceKrw": null'])assert(json.includes(expected),expected);assert.equal(mock.calls.length,1);assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().verifiedServices,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'확장 계획',exact:false}).click();await card.getByRole('button',{name:'조회 기능 열기'}).click();await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('2026-09-25'));
    await page.getByLabel('참가격 조사월',{exact:true}).selectOption('2026-08');await page.getByRole('status').filter({hasText:'다른 월의 조사일 조건을 지웠습니다.'}).waitFor();const changed=JSON.parse(await page.locator('textarea.code-input').inputValue());assert.equal(changed.month,'2026-08');assert.equal(changed.surveyDate,undefined);
    await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('2026-08-28'));assert.equal(await page.getByLabel('참가격 조사월',{exact:true}).inputValue(),'2026-08');await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();assert((await page.locator('.draft-inspector pre').innerText()).includes('FILE_000000007654112'));assert.equal(mock.calls.length,1);
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();assert((await page.getByRole('dialog').innerText()).includes('2026년 8월 조사'));assert.equal(mock.calls.length,2);
    await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'확장 계획',exact:false}).click();await card.getByRole('button',{name:'조회 기능 열기'}).click();await page.getByLabel('참가격 조사월',{exact:true}).selectOption('2026-08');await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('2026-08-28'));await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();assert((await page.getByRole('dialog').innerText()).includes('저장 파일 재사용'));assert.equal(mock.calls.length,2);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/champrice-cards-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});

test('Champrice form keeps JSON and filters in sync, pages without redownloading, and distinguishes empty states',async()=>{
  const mock=champriceMock();
  const row=champriceRow(),second=[...row],third=[...row];row[2]='0';row[5]='Y';second[0]='시험 우유(500ml)';second[2]='1500';second[5]='N';second[6]='Y';third[5]='';third[6]='';
  mock.flags.text=champriceCsv([row,second,third]);
  const r=await createRuntime({dataDir:tempDir('champrice-form-ui'),port:0,vault:new TestVault(),bootstrapCode:'champrice-form-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${r.baseUrl}/#setup=champrice-form-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    const openSearch=async()=>{await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'참가격 확장 계획',exact:true}).getByRole('button',{name:'조회 기능 열기'}).click();};
    const execute=async()=>{await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('region',{name:'참가격 조회 결과'}).waitFor();};
    const results=()=>page.getByRole('region',{name:'참가격 조회 결과'});
    await openSearch();assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());
    await page.getByText('JSON 입력',{exact:true}).click();
    const json=page.locator('textarea.code-input');await json.fill('{broken');assert(await page.getByLabel('참가격 조사월',{exact:true}).isDisabled());assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());
    await json.fill(JSON.stringify({productName:'우유',manufacturer:'시험제조사',storeQuery:'서울점',surveyDate:'2026-09-25',page:2,limit:1}));
    assert.equal(await page.getByLabel('상품명 필수',{exact:true}).inputValue(),'우유');assert.equal(await page.getByLabel('제조사 선택 · 전체 일치',{exact:true}).inputValue(),'시험제조사');
    await page.getByLabel('상품명 필수',{exact:true}).fill('시험 우유');assert.equal(JSON.parse(await json.inputValue()).page,1);
    await page.getByLabel('조사일 선택 · 비우면 전체 조사일',{exact:true}).fill('2026-08-28');assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());await page.getByLabel('조사일 선택 · 비우면 전체 조사일',{exact:true}).fill('2026-09-25');
    await page.getByText('JSON 입력',{exact:true}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await execute();assert((await results().innerText()).includes('0원'));assert((await results().innerText()).includes('Y · 있음'));assert((await results().innerText()).includes('N · 없음'));
    const firstQuery={...r.engine.jobs()[0]!.input};
    await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await results().getByText('1,500원',{exact:true}).waitFor();
    assert.deepEqual(r.engine.jobs()[0]!.input,{...firstQuery,page:2});assert((await results().innerText()).includes('시험 우유(500ml)'));assert.equal(mock.calls.length,1);
    await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await results().getByText('2,590원',{exact:true}).waitFor();assert.equal(await results().getByText('미수집',{exact:true}).count(),2);assert.equal(await page.getByRole('button',{name:'다음 페이지',exact:true}).count(),0);
    await page.getByRole('button',{name:'첫 페이지',exact:true}).click();await results().getByText('0원',{exact:true}).waitFor();assert.equal(mock.calls.length,1);
    await page.getByRole('button',{name:'닫기',exact:true}).click();await openSearch();await page.getByLabel('상품명 필수',{exact:true}).fill('없는상품');await execute();await results().getByRole('status').filter({hasText:'조건에 맞는 조사 기록이 없습니다.'}).waitFor();assert.equal(await results().getByRole('article').count(),0);
    await page.getByRole('button',{name:'닫기',exact:true}).click();await openSearch();await page.getByLabel('상품명 필수',{exact:true}).fill('우유');await page.getByText('페이지 설정',{exact:true}).click();await page.getByLabel('페이지',{exact:true}).fill('99');await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('0');assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('1');
    await page.getByLabel('상품명 필수',{exact:true}).press('Enter');await results().getByRole('status').filter({hasText:'이 페이지에는 없습니다.'}).waitFor();await page.getByRole('button',{name:'첫 페이지',exact:true}).click();await results().getByText('0원',{exact:true}).waitFor();
    await page.setViewportSize({width:1280,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'닫기',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert(await page.getByText('JSON 상세',{exact:true}).evaluate(el=>el===document.activeElement));await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(mock.calls.length,1);assert.equal(r.engine.accounts().length,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();await r.close();}
});
