import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { champriceMock } from './champrice-fixture.js';

test('Champrice mobile UI previews a keyless fixed month and shows survey prices and unknown discounts without an account',async()=>{
  const mock=champriceMock(),r=await createRuntime({dataDir:tempDir('champrice-ui'),port:0,vault:new TestVault(),bootstrapCode:'champrice-ui-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`${r.baseUrl}/#setup=champrice-ui-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click();const card=page.getByRole('article',{name:'참가격 확장 계획',exact:true});assert((await card.innerText()).includes('키 없이 조회'));await card.getByRole('button',{name:'조회 기능 열기'}).click();assert((await page.getByRole('dialog').innerText()).includes('2026년 9월'));assert((await page.getByRole('dialog').innerText()).includes('실시간 판매가'));
    await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('productName'));await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();const preview=await page.locator('.draft-inspector pre').innerText();assert(preview.includes('"type": "none"'));assert(preview.includes('"month": "2026-09"'));assert(preview.includes('localFilter'));assert.equal(mock.calls.length,0);
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();const result=await page.getByRole('dialog').innerText();for(const expected of ['시험 우유(1L)','"priceKrw": 2590','"sale": null','"onePlusOne": false','"currentPriceKrw": null','2026년 9월 조사'])assert(result.includes(expected),expected);assert.equal(mock.calls.length,1);assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().verifiedServices,0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
    mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/champrice-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});
