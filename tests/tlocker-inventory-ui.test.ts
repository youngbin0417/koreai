import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { TestVault,tempDir } from './helpers.js';
import { lockerMock } from './tlocker-inventory-fixture.js';

test('locker mobile UI searches keyless installation inventory, paginates from cache and keeps live availability separate',async()=>{
  const mock=lockerMock(),r=await createRuntime({dataDir:tempDir('locker-inventory-ui'),port:0,vault:new TestVault(),bootstrapCode:'locker-ui-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher}),browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`${r.baseUrl}/#setup=locker-ui-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();await page.getByRole('button',{name:'확장 계획',exact:false}).click();
    const plan=page.getByRole('article',{name:'또타라커 확장 계획',exact:true});await plan.getByRole('button',{name:'조회 기능 열기',exact:true}).click();await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('"query": "서울"'));
    await page.getByLabel('역·보관함 이름',{exact:true}).fill('서울');await page.getByText('페이지 설정',{exact:true}).click();await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('1');await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();assert.equal(mock.calls.length,0);assert((await page.getByRole('dialog').innerText()).includes('설치'));assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isEnabled());
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();const result=page.getByRole('region',{name:'사물함 설치 조회 결과',exact:true});await result.waitFor();await result.getByRole('article',{name:'서울역1~22',exact:true}).waitFor();assert.equal(mock.calls.length,1);assert((await result.innerText()).includes('현재 빈칸'));assert((await result.innerText()).includes('기준일을 확인할 수 없습니다'));assert((await result.getByRole('link',{name:'Android 앱에서 빈칸 직접 확인',exact:false}).getAttribute('href'))?.includes('io.mobinity.locker'));
    await result.getByRole('button',{name:'다음 페이지',exact:true}).click();await result.getByRole('article',{name:'서울역23~44',exact:true}).waitFor();assert.equal(mock.calls.length,1);assert((await result.innerText()).includes('0칸'));assert((await result.innerText()).includes('검증된 로컬 파일을 재사용'));await result.getByRole('button',{name:'첫 페이지',exact:true}).click();await result.getByRole('article',{name:'서울역1~22',exact:true}).waitFor();assert.equal(mock.calls.length,1);
    await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'확장 계획',exact:false}).click();await plan.getByRole('button',{name:'조회 기능 열기',exact:true}).click();await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('textarea.code-input')?.value.includes('"query": "서울"'));
    await page.getByLabel('호선·시설 분류',{exact:true}).selectOption('1');await page.getByLabel('설치 크기 조건',{exact:true}).selectOption('large');await page.getByRole('button',{name:'실행 요청',exact:false}).click();await result.getByText('전체 자료 4묶음 · 검색 일치 1묶음 · 1페이지',{exact:true}).waitFor();assert.equal(mock.calls.length,1);assert.equal(await result.getByRole('button',{name:'다음 페이지',exact:true}).count(),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(r.engine.accounts().length,0);assert.equal(r.engine.metrics().supportedActions,0);mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/tlocker-inventory-mobile.png'),fullPage:true});
  }finally{await browser.close();await r.close();}
});
