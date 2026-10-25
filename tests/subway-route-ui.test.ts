import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { subwayRouteAction } from '../src/connectors/subway-route.js';
import { TestVault, tempDir } from './helpers.js';
import { routeMock, routeSecret } from './subway-route-fixture.js';

test('mobile route flow registers a separate key, preserves both station drafts and runs HTTPS with the old HTTP APIs blocked', async () => {
  const mock = routeMock(), r = await createRuntime({ dataDir: tempDir('subway-route-ui'), port: 0, vault: new TestVault(), bootstrapCode: 'route-ui-bootstrap', evidenceMode: 'mock', fetcher: mock.fetcher });
  const old = await r.engine.saveAccount({ label: '기존 도착 계정', credentialType: 'seoul-subway-api', allowedActions: ['seoul-subway.arrivals'], secrets: { apiKey: 'old-route-ui-arrival-key' } });
  const browser = await chromium.launch({ channel: (process.env.KOREAI_TEST_BROWSER_CHANNEL ?? browserDefaults().channel) as BrowserChannel, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = []; let imageRequests = 0;
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.url().includes('/maps/')) imageRequests++; });
    await page.goto(`${r.baseUrl}/#setup=route-ui-bootstrap`); await page.getByRole('button', { name: '엔진 연결' }).click();
    await page.getByRole('button', { name: '연결 계정', exact: false }).first().click(); await page.getByRole('button', { name: '＋ 계정 연결' }).click(); await page.getByLabel('계정 종류').selectOption('seoul-subway-route-api'); await page.getByLabel('내가 알아볼 계정 이름').fill('경로 전용 키'); await page.getByLabel('serviceKey', { exact: true }).fill(routeSecret); await page.getByLabel(subwayRouteAction.title, { exact: false }).check(); await page.getByRole('button', { name: '계정 저장', exact: true }).click(); await page.getByRole('heading', { name: '경로 전용 키' }).waitFor();
    const routeAccount = r.engine.accounts().find(account => account.credentialType === 'seoul-subway-route-api')!;
    assert.deepEqual(routeAccount.allowedActions, [subwayRouteAction.id]);
    await page.getByRole('button', { name: '지하철 노선도', exact: false }).click();
    await page.getByLabel('역 이름·도착정보 역 ID 검색', { exact: true }).fill('신도림'); await page.getByLabel('역 목록 호선', { exact: true }).selectOption('2호선'); await page.getByRole('button', { name: '신도림 · 2호선 선택', exact: true }).click(); await page.getByRole('button', { name: '경로 출발역 조건 채우기', exact: true }).click();
    await page.getByLabel('출발역 이름', { exact: true }).waitFor(); assert.equal(await page.getByLabel('출발역 이름', { exact: true }).inputValue(), '신도림'); await page.getByLabel('도착역 이름', { exact: true }).fill('서울역'); await page.getByLabel('경로 기준', { exact: true }).selectOption('transfer'); await page.getByLabel('경로 기준 시각', { exact: false }).fill('2026-10-25T09:00:00+09:00'); await page.getByLabel('공급자 열차 시간표 포함').check();
    const chosen = await page.getByLabel('사용할 계정', { exact: true }).inputValue(); assert.equal(chosen, routeAccount.id);
    await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click(); await page.getByLabel('역 이름·도착정보 역 ID 검색', { exact: true }).fill('시청'); await page.getByRole('button', { name: '시청 · 2호선 선택', exact: true }).click(); await page.getByRole('button', { name: '경로 도착역 조건 채우기', exact: true }).click();
    assert.equal(await page.getByLabel('출발역 이름', { exact: true }).inputValue(), '신도림'); assert.equal(await page.getByLabel('도착역 이름', { exact: true }).inputValue(), '시청'); assert.equal(await page.getByLabel('경로 기준', { exact: true }).inputValue(), 'transfer'); assert.equal(await page.getByLabel('경로 기준 시각', { exact: false }).inputValue(), '2026-10-25T09:00:00+09:00'); assert(await page.getByLabel('공급자 열차 시간표 포함').isChecked()); assert.equal(await page.getByLabel('사용할 계정', { exact: true }).inputValue(), chosen);
    assert.equal(mock.calls.length, 0); assert.equal(r.engine.jobs().length, 0); assert.equal(imageRequests, 0);
    assert.equal(await page.getByRole('dialog').getByText('지하철 API HTTP 전송은 차단 중입니다.', { exact: false }).count(), 0); assert(await page.getByRole('button', { name: '실행 요청', exact: false }).isEnabled());
    await page.getByRole('button', { name: '요청 구조 미리보기', exact: true }).click(); await page.getByRole('heading', { name: '요청 구조 · 외부 호출 없음' }).waitFor(); assert.equal(mock.calls.length, 0);
    await page.getByRole('button', { name: '실행 요청', exact: false }).click(); await page.getByRole('heading', { name: '공급자 경로·환승 결과', exact: true }).waitFor(); assert.equal(mock.calls.length, 1); assert.equal(mock.calls[0]!.searchParams.get('arvlStn'), '시청'); assert.equal(mock.calls[0]!.searchParams.get('schInclYn'), 'Y');
    assert((await page.getByRole('region', { name: '지하철 경로 결과' }).innerText()).includes('25:10:00')); assert(!(await page.locator('body').innerText()).includes(routeSecret)); assert.deepEqual(r.engine.accounts().find(account => account.id === old.id)!.allowedActions, ['seoul-subway.arrivals']); assert.equal(r.engine.metrics().supportedActions, 0); assert.deepEqual(errors, []); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await browser.close(); await r.close(); }
});
