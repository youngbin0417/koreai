import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { work24Action } from '../src/connectors/work24.js';
import { work24Mock,work24Secret } from './work24-fixture.js';

test('Work24 mobile UI explains company approval, saves authKey, previews XML and shows salary/deadline raw values',async()=>{
  const mock=work24Mock(),r=await createRuntime({dataDir:tempDir('work24-ui'),port:0,vault:new TestVault(),bootstrapCode:'work24-ui-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${r.baseUrl}/#setup=work24-ui-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'연결 계정',exact:false}).first().click();await page.getByRole('button',{name:'＋ 계정 연결'}).click();await page.getByLabel('계정 종류').selectOption('work24-api');assert((await page.getByRole('dialog').innerText()).includes('기업회원'));assert((await page.getByRole('dialog').innerText()).includes('심사'));
    await page.getByLabel('내가 알아볼 계정 이름').fill('내 고용24');await page.getByLabel('authKey',{exact:true}).fill(work24Secret);await page.getByLabel(work24Action.title,{exact:false}).check();await page.getByRole('button',{name:'계정 저장',exact:true}).click();await page.getByRole('heading',{name:'내 고용24'}).waitFor();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'고용24 확장 계획',exact:true}).getByRole('button',{name:'조회 기능 열기'}).click();await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('keyword'));
    await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();const preview=await page.locator('.draft-inspector pre').innerText();for(const expected of ['"method": "GET"','"returnType": "XML"','"secretField": "authKey"'])assert(preview.includes(expected));assert(!preview.includes(work24Secret));assert.equal(mock.calls.length,0);
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();const text=await page.getByRole('dialog').innerText();for(const expected of ['개발자 모집','250만원 ~ 300만원','채용시까지','"normalizedAmount": null','"currentlyAcceptingApplications": null','출처: 고용24'])assert(text.includes(expected),expected);assert(!text.includes(work24Secret));assert.equal(mock.calls.length,1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(r.engine.metrics().verifiedServices,0);
    mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/work24-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});
