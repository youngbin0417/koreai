import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { subwayMapSnapshot as snapshot } from '../src/research/subway-map.js';
import { TestVault, tempDir } from './helpers.js';

const browserOptions = { channel: (process.env.KOREAI_TEST_BROWSER_CHANNEL ?? browserDefaults().channel) as BrowserChannel, headless: true };
test('mobile subway map loads only on demand, zooms and pans with keyboard/mouse/touch while keeping source and original bytes', async () => {
  let providerCalls = 0; const r = await createRuntime({ dataDir: tempDir('subway-map-ui'), port: 0, vault: new TestVault(), bootstrapCode: 'map-ui-bootstrap', evidenceMode: 'mock', fetcher: async () => { providerCalls++; throw Error('No provider API expected'); } });
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage(), errors: string[] = []; let imageRequests = 0;
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (new URL(request.url()).pathname === snapshot.assetUrl) imageRequests++; });
    await page.goto(`${r.baseUrl}/#setup=map-ui-bootstrap`); await page.getByRole('button', { name: '엔진 연결' }).click(); await page.getByRole('button', { name: '기본 서비스 연결', exact: false }).first().click();
    await page.getByRole('article', { name: '서울·수도권 지하철 기본 연결', exact: true }).getByRole('button', { name: '국문 노선도 보기', exact: true }).click(); await page.getByRole('heading', { name: '지하철 노선도', exact: true }).waitFor(); assert.equal(imageRequests, 0);
    await page.getByRole('button', { name: '국문 노선도 불러오기', exact: false }).click(); const image = page.getByRole('img', { name: snapshot.title, exact: false }), viewport = page.getByRole('region', { name: '확대 가능한 수도권 지하철 노선도', exact: true });
    await page.getByRole('button', { name: '확대', exact: true }).waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector<HTMLImageElement>('.subway-map-stage img')?.naturalWidth === 6142 && document.querySelector<HTMLInputElement>('.subway-map input[type=range]')?.disabled === false);
    assert.equal(imageRequests, 1); const fitWidth = await image.evaluate(el => el.getBoundingClientRect().width); await page.getByRole('button', { name: '확대', exact: true }).click(); assert((await image.evaluate(el => el.getBoundingClientRect().width)) > fitWidth);
    await page.getByRole('button', { name: '원본 크기', exact: true }).click(); assert.equal(await image.evaluate(el => el.getBoundingClientRect().width), 6142);
    await viewport.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; }); await viewport.focus(); await page.keyboard.press('ArrowRight'); assert.equal(await viewport.evaluate(el => el.scrollLeft), 80);
    await viewport.scrollIntoViewIfNeeded(); let box = (await viewport.boundingBox())!; await page.mouse.move(box.x + 200, box.y + 160); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 90, { steps: 5 }); await page.mouse.up(); assert((await viewport.evaluate(el => el.scrollLeft)) >= 170); assert((await viewport.evaluate(el => el.scrollTop)) >= 60);
    const beforeTouch = await viewport.evaluate(el => el.scrollTop); box = (await viewport.boundingBox())!; const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 170, y: box.y + 210 }] });
    for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 170, y: box.y + 210 - step * 24 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForFunction(value => document.querySelector('.subway-map-viewport')!.scrollTop > value, beforeTouch); await cdp.detach();
    await page.getByRole('button', { name: '화면 맞춤', exact: true }).click(); assert.equal(await viewport.evaluate(el => el.scrollLeft), 0); assert.equal(await viewport.evaluate(el => el.scrollTop), 0); assert.equal(await image.evaluate(el => el.getBoundingClientRect().width), await viewport.evaluate(el => el.clientWidth));
    await page.setViewportSize({ width: 820, height: 900 }); await page.waitForFunction(() => document.querySelector('.subway-map-stage')!.clientWidth === document.querySelector('.subway-map-viewport')!.clientWidth); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(imageRequests, 1); assert((await page.getByRole('region', { name: '수도권 지하철 노선도 보기', exact: true }).innerText()).includes('공공누리 제3유형'));
    assert.equal(providerCalls, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(r.engine.accounts().length, 0); assert.equal(r.engine.metrics().supportedActions, 0); assert.deepEqual(errors, []);
    mkdirSync(resolve('.test-data/screenshots'), { recursive: true }); await page.screenshot({ path: resolve('.test-data/screenshots/subway-map-mobile.png'), fullPage: true });
  } finally { await browser.close(); await r.close(); }
});

test('map failure offers retry and official sources, while authenticated fragment navigation starts without auto downloading', async () => {
  const r = await createRuntime({ dataDir: tempDir('subway-map-retry'), port: 0, vault: new TestVault(), bootstrapCode: 'map-retry-bootstrap', evidenceMode: 'mock' }), browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(); let imageRequests = 0;
    await page.route('**' + snapshot.assetUrl, async route => { imageRequests++; if (imageRequests === 1) await route.abort(); else await route.continue(); });
    await page.goto(`${r.baseUrl}/#setup=map-retry-bootstrap`); await page.getByRole('button', { name: '엔진 연결' }).click(); await page.getByRole('button', { name: '지하철 노선도', exact: false }).click(); await page.getByRole('button', { name: '국문 노선도 불러오기', exact: false }).click(); await page.getByRole('alert').filter({ hasText: '노선도를 불러오지 못했습니다.' }).waitFor(); assert(await page.getByRole('button', { name: '확대', exact: true }).isDisabled());
    assert.equal(await page.getByRole('link', { name: '국문 원본 JPG 열기', exact: false }).getAttribute('href'), snapshot.assetUrl); assert.equal(await page.getByRole('link', { name: '4개 언어 원본 ZIP 받기', exact: false }).getAttribute('href'), snapshot.originalUrl);
    await page.getByRole('button', { name: '노선도 다시 불러오기', exact: true }).click(); await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.subway-map input[type=range]')?.disabled === false); assert.equal(imageRequests, 2);
    await page.getByRole('button', { name: '확장 계획', exact: false }).click(); await page.getByRole('article', { name: '서울·수도권 지하철 확장 계획', exact: true }).getByRole('button', { name: '서울 지하철 실시간 도착 조회', exact: true }).click(); await page.getByLabel('역 이름', { exact: true }).fill('시청');
    const popup = context.waitForEvent('page'); await page.getByRole('link', { name: '국문 노선도 확대해서 보기', exact: false }).click(); const linked = await popup; await linked.getByRole('heading', { name: '지하철 노선도', exact: true }).waitFor(); assert.equal(await linked.getByRole('img').count(), 0); assert.equal(await page.getByLabel('역 이름', { exact: true }).inputValue(), '시청'); assert.equal(r.engine.jobs().length, 0);
  } finally { await browser.close(); await r.close(); }
});
