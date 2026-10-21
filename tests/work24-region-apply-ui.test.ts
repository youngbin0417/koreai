import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { TestVault,tempDir } from './helpers.js';
import { browserDefaults,type BrowserChannel } from '../src/core/platform.js';
import { work24Action } from '../src/connectors/work24.js';
import { work24RegionsAction } from '../src/connectors/work24-regions.js';
import { work24Mock,work24RegionsMock,work24Secret,work24Row,work24Xml } from './work24-fixture.js';

test('Work24 mobile region selection preserves the job draft/account without dispatch or automatic grants',async()=>{
  const regions=work24RegionsMock(),jobs=work24Mock(),r=await createRuntime({dataDir:tempDir('work24-apply-ui'),port:0,vault:new TestVault(),bootstrapCode:'apply-region-bootstrap',evidenceMode:'mock',fetcher:(url,init)=>String(url).includes('21L01.do')?regions.fetcher(url,init):jobs.fetcher(url,init)});
  const regionAccount=await r.engine.saveAccount({label:'지역 전용',credentialType:'work24-api',allowedActions:[work24RegionsAction.id],secrets:{authKey:work24Secret}});
  const listing=await r.engine.saveAccount({label:'공고 전용',credentialType:'work24-api',allowedActions:[work24Action.id],secrets:{authKey:work24Secret}});
  const browser=await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`${r.baseUrl}/#setup=apply-region-bootstrap`);await page.getByRole('button',{name:'엔진 연결'}).click();
    const open=async(title:string)=>{await page.getByRole('button',{name:'확장 계획',exact:false}).click();await page.getByRole('article',{name:'고용24 확장 계획',exact:true}).getByRole('button',{name:title,exact:true}).click();};
    await open(work24Action.title);await page.getByLabel('검색어 필수').fill('개발자');await page.getByLabel('고용형태 선택',{exact:true}).selectOption('11');await page.getByText('페이지 설정',{exact:true}).click();await page.getByLabel('페이지',{exact:true}).fill('8');await page.getByLabel('한 번에 볼 건수',{exact:true}).fill('25');await page.getByLabel('사용할 계정',{exact:true}).selectOption(listing.id);await page.getByRole('button',{name:'닫기',exact:true}).click();
    await open(work24RegionsAction.title);await page.getByLabel('사용할 계정',{exact:true}).selectOption(regionAccount.id);await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('region',{name:'고용24 지역 코드 결과'}).waitFor();
    await page.getByRole('article',{name:'강남구 · 11680',exact:true}).getByRole('button',{name:'이 지역으로 채용공고 조건 채우기',exact:true}).click();await page.getByRole('dialog',{name:work24Action.title,exact:true}).waitFor();
    assert.equal(await page.getByLabel('검색어 필수').inputValue(),'개발자');assert.equal(await page.getByLabel('고용형태 선택',{exact:true}).inputValue(),'11');assert.equal(await page.getByLabel('근무지역 선택',{exact:true}).inputValue(),'11680');assert.equal(await page.getByLabel('사용할 계정',{exact:true}).inputValue(),listing.id);
    assert((await page.getByRole('dialog').innerText()).includes('서울 / 강남구'));assert((await page.getByRole('dialog').innerText()).includes('API 조회 시각'));await page.getByText('JSON 입력',{exact:true}).click();assert.deepEqual(JSON.parse(await page.locator('textarea.code-input').inputValue()),{keyword:'개발자',page:1,limit:25,employmentType:'11',regionCode:'11680'});
    assert.equal(regions.calls.length,1);assert.equal(jobs.calls.length,0);assert.equal(r.engine.jobs().length,1);assert.deepEqual(r.engine.accounts(admin).find(account=>account.id===regionAccount.id)!.allowedActions,[work24RegionsAction.id]);
    jobs.flags.body=work24Xml([work24Row({empTpCd:'11'})],{display:25});await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('region',{name:'고용24 조회 결과',exact:true}).waitFor();assert.equal(jobs.calls.length,1);assert.equal(jobs.calls[0]!.searchParams.get('region'),'11680');assert.equal(jobs.calls[0]!.searchParams.get('empTp'),'11');assert.equal(r.engine.jobs()[0]!.accountId,listing.id);assert(!JSON.stringify(r.engine.jobs()[0]!.input).includes('retrievedAt'));
    // If the previously selected job account is disabled, never inherit the region account.
    await page.getByRole('button',{name:'닫기',exact:true}).click();await r.engine.saveAccount({id:listing.id,label:listing.label,credentialType:'work24-api',allowedActions:[work24Action.id],enabled:false});await open(work24RegionsAction.title);await page.getByRole('button',{name:'실행 요청',exact:false}).click();await page.getByRole('region',{name:'고용24 지역 코드 결과'}).waitFor();
    await page.getByRole('article',{name:'지역무관 · 00000',exact:true}).getByRole('button',{name:'이 지역으로 채용공고 조건 채우기',exact:true}).click();await page.getByRole('dialog',{name:work24Action.title,exact:true}).waitFor();assert.equal(await page.getByLabel('사용할 계정',{exact:true}).inputValue(),'');assert(await page.getByRole('button',{name:'실행 요청',exact:false}).isDisabled());assert.equal(jobs.calls.length,1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  }finally{await browser.close();await r.close();}
});
