import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { tmapAction } from '../src/connectors/tmap.js';
import { tmapMock,tmapSecret } from './tmap-fixture.js';

test('TMAP mobile UI registers a key, previews a summary POST, executes and removes an expired result without another provider call',async()=>{
  const mock=tmapMock(),r=await createRuntime({dataDir:tempDir('tmap-ui'),port:0,vault:new TestVault(),bootstrapCode:'tmap-ui-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${r.baseUrl}/#setup=tmap-ui-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'연결 계정',exact:false}).first().click();await page.getByRole('button',{name:'＋ 계정 연결'}).click();await page.getByLabel('계정 종류').selectOption('tmap-api');await page.getByLabel('내가 알아볼 계정 이름').fill('내 TMAP');await page.getByLabel('appKey',{exact:true}).fill(tmapSecret);await page.getByLabel(tmapAction.title,{exact:false}).check();await page.getByRole('button',{name:'계정 저장',exact:true}).click();await page.getByRole('heading',{name:'내 TMAP'}).waitFor();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'TMAP 확장 계획',exact:true}).getByRole('button',{name:'조회 기능 열기'}).click();await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('longitude'));
    await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();const preview=await page.locator('.draft-inspector pre').innerText();for(const expected of ['"method": "POST"','"totalValue": 2','WGS84GEO','"secretField": "appKey"'])assert(preview.includes(expected));assert(!preview.includes(tmapSecret));assert.equal(mock.calls.length,0);
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('heading',{name:'실행 결과',exact:true}).waitFor();const text=await page.getByRole('dialog').innerText();for(const expected of ['"distanceMetres": 12500','"durationSeconds": 1850','"providerTotalFareKrw": 0','"responseIdentityVerified": false','출처: TMAP'])assert(text.includes(expected),expected);assert(!text.includes(tmapSecret));assert.equal(mock.calls.length,1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const job=r.engine.jobs()[0]!;job.resultExpiresAt=new Date(Date.now()-1).toISOString();r.store.saveJob(job);await page.getByText('공급자 결과의 사용기한이 만료되어 결과를 제거했습니다. 새 작업으로 다시 조회하세요.',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'실행 결과',exact:true}).count(),0);assert.equal(mock.calls.length,1);assert.deepEqual(errors,[]);assert.equal(r.engine.metrics().verifiedServices,0);
    mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/tmap-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});
