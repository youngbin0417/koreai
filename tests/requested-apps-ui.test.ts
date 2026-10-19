import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { TestVault, tempDir } from './helpers.js';

test('mobile requested-app plans support request filtering, aliases and reviewed activation states', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error('Unexpected provider request'); };
  const r = await createRuntime({ dataDir: tempDir('requested-ui'), port: 0, vault: new TestVault(), fetcher, bootstrapCode: 'requested-ui-setup', evidenceMode: 'mock' }); let browser: Browser | undefined;
  try {
    browser = await chromium.launch({channel:(process.env.KOREAI_TEST_BROWSER_CHANNEL??browserDefaults().channel) as BrowserChannel,headless:true});
    const page = await browser.newPage({viewport:{width:390,height:844}}), errors: string[] = []; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${r.baseUrl}/#setup=requested-ui-setup`); await page.getByRole('button',{name:'로컬 엔진 연결'}).click();
    await page.getByRole('button',{name:'확장 계획',exact:false}).click(); assert.equal(await page.locator('.expansion-card').count(),59);
    await page.getByLabel('추가 요청 앱만 보기').check(); assert.equal(await page.locator('.expansion-card').count(),36);
    await page.getByLabel('확장 후보 검색').fill('yanolja'); await page.getByRole('article',{name:'NOL(야놀자) 확장 계획',exact:true}).waitFor(); assert.equal(await page.locator('.expansion-card').count(),1);
    await page.getByLabel('확장 후보 검색').fill('동물병원'); const card=page.getByRole('article',{name:'공공 동물병원 정보 확장 계획',exact:true});
    await card.getByText('첫 연결 초안',{exact:true}).click(); const plan=await card.locator('.requested-plan').innerText(); assert(plan.includes('공개 데이터 후보')); assert(plan.includes('현재 진료')); assert(plan.includes('조회 실행기 구현')); assert.equal(await card.getByRole('button',{name:'조회 기능 열기'}).count(),1);
    await page.getByLabel('확장 후보 검색').fill('통신비'); assert.equal(await page.locator('.expansion-card').count(),4);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)); assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'서비스 카탈로그',exact:false}).click(); await page.getByLabel('서비스 검색').fill('musinsa'); await page.getByRole('heading',{name:'무신사',exact:true}).waitFor(); assert.equal(await page.locator('.service-card').count(),1);
    assert.equal(calls,0); assert.equal(r.engine.jobs().length,0); assert.equal(r.engine.metrics().verifiedServices,0);
  } finally { await browser?.close(); await r.close(); }
});
