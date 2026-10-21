import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { work24RegionsAction as action } from '../src/connectors/work24-regions.js';
import { work24RegionsMock,work24RegionsXml,work24Secret,work24AccessError } from './work24-fixture.js';

test('Work24 region mobile UI uses explicit accounts, previews without a key, filters received hierarchy locally and resumes auth',async()=>{
  const mock=work24RegionsMock(),r=await createRuntime({dataDir:tempDir('work24-regions-ui'),port:0,vault:new TestVault(),bootstrapCode:'work24-regions-bootstrap',evidenceMode:'mock',fetcher:mock.fetcher});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${r.baseUrl}/#setup=work24-regions-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    await page.getByRole('button',{name:'연결 계정',exact:false}).first().click();await page.getByRole('button',{name:'＋ 계정 연결'}).click();await page.getByLabel('계정 종류').selectOption('work24-api');assert((await page.getByRole('dialog').innerText()).includes('별도로 허용'));
    await page.getByLabel('내가 알아볼 계정 이름').fill('공통코드용 고용24');await page.getByLabel('authKey',{exact:true}).fill(work24Secret);await page.getByLabel(action.title,{exact:false}).check();await page.getByRole('button',{name:'계정 저장',exact:true}).click();await page.getByRole('heading',{name:'공통코드용 고용24'}).waitFor();
    const open=async()=>{await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'고용24 확장 계획',exact:true}).getByRole('button',{name:action.title,exact:true}).click();};
    await open();assert((await page.getByRole('dialog').innerText()).includes('XLS 코드표'));await page.getByRole('button',{name:'예시 입력 불러오기'}).click();await page.getByRole('button',{name:'요청 구조 미리보기'}).click();await page.getByRole('heading',{name:'요청 구조 · 외부 호출 없음'}).waitFor();const preview=await page.locator('.draft-inspector pre').innerText();for(const expected of ['"target": "CMCD"','"dtlGb": "1"','"secretField": "authKey"'])assert(preview.includes(expected),expected);assert(!preview.includes(work24Secret));assert.equal(mock.calls.length,0);
    await page.getByLabel('사용할 계정',{exact:true}).selectOption('');assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());assert.equal(mock.calls.length,0);
    const account=r.engine.accounts({id:'local-admin',name:'admin',role:'admin',allowedActions:[],allowedAccountIds:[]})[0]!;await page.getByLabel('사용할 계정',{exact:true}).selectOption(account.id);
    await page.getByText('JSON 입력',{exact:true}).click();await page.locator('textarea.code-input').fill('{"dtlGb":"2"}');assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());await page.locator('textarea.code-input').fill('{}');await page.getByText('JSON 입력',{exact:true}).click();
    await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('region',{name:'고용24 지역 코드 결과',exact:true}).waitFor();assert.equal(mock.calls.length,1);assert.equal(await page.locator('.work24-card').count(),3);
    await page.getByLabel('받은 코드에서 이름·코드 찾기').fill('11680');assert.equal(await page.locator('.work24-card').count(),1);assert((await page.locator('.work24-card').innerText()).includes('서울 · 11000'));await page.getByLabel('받은 코드에서 이름·코드 찾기').fill('서울');assert.equal(await page.locator('.work24-card').count(),2);await page.getByLabel('받은 코드에서 이름·코드 찾기').fill('없는지역');assert((await page.getByRole('dialog').innerText()).includes('0개 표시'));assert.equal(mock.calls.length,1);
    await page.getByLabel('받은 코드에서 이름·코드 찾기').fill('');const result=await page.getByRole('dialog').innerText();for(const expected of ['정적 XLS','공급자 total 3','상위 2개 / 하위 1개','한국 시간','출처: 고용24 공통코드'])assert(result.includes(expected),expected);assert(!result.includes(work24Secret));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1280,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:390,height:844});
    await page.getByRole('dialog').evaluate(element=>{element.scrollTop=0;});mkdirSync(resolve('.test-data/screenshots'),{recursive:true});await page.screenshot({path:resolve('.test-data/screenshots/work24-regions-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'닫기',exact:true}).click();mock.flags.body=work24RegionsXml('',0);await open();await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByText('지역 코드가 반환되지 않았습니다.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'닫기',exact:true}).click();mock.flags.body=work24AccessError;await open();await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('button',{name:'필요한 작업을 마쳤습니다 · 재개',exact:true}).waitFor();const paused=r.engine.store.allJobs().find(job=>job.state==='awaiting_auth')!;mock.flags.body=work24RegionsXml();await page.getByRole('button',{name:'필요한 작업을 마쳤습니다 · 재개',exact:true}).click();await page.getByRole('region',{name:'고용24 지역 코드 결과',exact:true}).waitFor();assert.equal(r.engine.store.allJobs().find(job=>job.id===paused.id)?.state,'succeeded');
    assert.deepEqual(errors,[]);assert.equal(r.engine.metrics().verifiedServices,0);assert.equal(r.engine.metrics().supportedActions,0);
  }finally{await browser.close();await r.close();}
});
