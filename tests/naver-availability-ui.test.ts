import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault, tempDir } from './helpers.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';

test('Naver mobile UI explains retirement and AI restrictions, removes account grants and keeps execution disabled',async()=>{
  let calls=0;const r=await createRuntime({dataDir:tempDir('naver-unavailable-ui'),port:0,vault:new TestVault(),bootstrapCode:'naver-unavailable-ui',fetcher:async()=>{calls++;throw Error('must not call');}});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${r.baseUrl}/#setup=naver-unavailable-ui`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'서비스 카탈로그',exact:false}).click();await page.getByLabel('서비스 검색').fill('네이버 검색');
    for(const title of ['네이버 도서 검색','네이버 ISBN 도서 조회','네이버 쇼핑 검색','네이버 뉴스 검색']){
      await page.getByRole('button',{name:new RegExp(title)}).click();const dialog=page.getByRole('dialog');assert(await dialog.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());assert.equal(await dialog.getByRole('button',{name:'계정 관리',exact:true}).count(),0);
      assert((await dialog.innerText()).includes(title==='네이버 뉴스 검색'?'AI 입력':'종료'));assert(await dialog.getByRole('link',{name:'공식 근거'}).isVisible());
      if(title==='네이버 도서 검색'){
        await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('한국 문학'));
        await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();assert((await page.locator('.draft-inspector pre').innerText()).includes('"kind": "retired"'));
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'닫기',exact:true}).click();
    }
    await page.getByRole('button',{name:'연결 계정',exact:false}).first().click();await page.getByRole('button',{name:'＋ 계정 연결'}).click();assert.equal(await page.getByLabel('계정 종류').locator('option[value="naver-app"]').count(),0);await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('button',{name:'에이전트 연결',exact:false}).first().click();await page.getByRole('button',{name:'＋ 에이전트 연결'}).click();assert.equal(await page.getByRole('dialog').getByText('네이버 뉴스 검색',{exact:true}).count(),0);await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click();assert((await page.getByRole('article',{name:'네이버 도서 검색 확장 계획'}).innerText()).includes('도서 API 종료'));assert.deepEqual(errors,[]);assert.equal(calls,0);
    mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/naver-unavailable-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});
