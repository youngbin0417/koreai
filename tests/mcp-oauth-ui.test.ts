import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { TestVault, tempDir } from './helpers.js';
import { ownedOAuth } from './mcp-oauth-fixture.js';

test('mobile MCP UI completes cross-site OAuth, grants account access, approves a tool and disconnects', async () => {
  const p = await ownedOAuth(), r = await createRuntime({ dataDir: tempDir('mcp-oauth-ui'), port: 0, vault: new TestVault(), bootstrapCode: 'mcp-ui-setup', evidenceMode: 'mock' });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: (process.env.KOREAI_TEST_BROWSER_CHANNEL ?? browserDefaults().channel) as BrowserChannel, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
    page.setDefaultTimeout(15_000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${r.baseUrl}/#setup=mcp-ui-setup`); await page.getByRole('button', { name: '로컬 엔진 연결' }).click();
    await page.getByRole('button', { name: '에이전트 연결', exact: false }).first().click(); await page.getByRole('button', { name: '＋ 서버 연결' }).click();
    await page.getByLabel('연결 이름', { exact: true }).fill('휴대폰 시험 MCP');
    await page.getByLabel('MCP 서버 주소', { exact: true }).fill(p.url);
    await page.getByLabel('가져올 도구 이름 · 쉼표로 구분').fill('echo');
    await page.getByRole('button', { name: 'OAuth 로그인 준비', exact: true }).click();
    const card = page.getByRole('article', { name: '휴대폰 시험 MCP MCP 연결', exact: true });
    await card.getByText('OAuth 로그인 필요', { exact: true }).waitFor();
    const [popup] = await Promise.all([page.waitForEvent('popup'), card.getByRole('link', { name: '서비스 로그인 열기', exact: false }).click()]);
    await popup.getByRole('button', { name: '시험 서비스 로그인 승인', exact: true }).click();
    await popup.getByRole('heading', { name: 'MCP 서버에 연결됐습니다.', exact: true }).waitFor(); await popup.close();
    await card.getByText('OAuth 로그인 완료', { exact: true }).waitFor();
    assert.equal(await card.getByRole('link', { name: '서비스 로그인 열기', exact: false }).count(), 0); assert.equal(p.record.calls, 0);
    await page.getByRole('button', { name: '＋ 에이전트 연결' }).click();
    await page.getByLabel('에이전트 이름', { exact: true }).fill('내 MCP 에이전트');
    await page.getByRole('checkbox', { name: '휴대폰 시험 MCP · MCP OAuth', exact: true }).check();
    await page.getByRole('checkbox', { name: '휴대폰 시험 MCP · echo', exact: true }).check();
    await page.getByRole('button', { name: '연결 토큰 발급' }).click(); await page.getByRole('button', { name: 'MCP 설정 복사' }).waitFor();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '휴대폰 시험 MCP · echo', exact: false }).click();
    assert.deepEqual(errors, []); await page.getByRole('dialog').waitFor();
    await page.getByLabel('실행할 내용 · JSON', { exact: false }).fill(JSON.stringify({ message: '휴대폰 OAuth 실행' }));
    await page.getByRole('button', { name: '실행 요청', exact: false }).click();
    await page.getByRole('button', { name: '이 내용으로 승인하고 실행', exact: true }).waitFor(); assert.equal(p.record.calls, 0);
    await page.getByRole('button', { name: '이 내용으로 승인하고 실행', exact: true }).click();
    await page.getByRole('heading', { name: '실행 결과', exact: true }).waitFor(); assert.equal(p.record.calls, 1);
    const result = await page.getByRole('dialog').innerText(); assert(result.includes('휴대폰 OAuth 실행')); for (const secret of p.secrets()) assert(!result.includes(secret));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); assert.deepEqual(errors, []);
    const screenshots = resolve('.test-data/screenshots'); mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: resolve(screenshots, 'mcp-oauth-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: resolve(screenshots, 'mcp-oauth-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '에이전트 연결', exact: false }).first().click();
    const refreshed = page.waitForResponse(response => response.url().endsWith('/oauth/refresh') && response.request().method() === 'POST');
    await card.getByRole('button', { name: '토큰 갱신', exact: true }).click();
    assert.equal((await refreshed).status(), 200); await card.getByText('OAuth 로그인 완료', { exact: true }).waitFor();
    assert.equal(p.record.tokens.filter(body => body.grant_type === 'refresh_token').length, 1); assert.equal(p.record.calls, 1);
    await card.getByRole('button', { name: '연결 해제', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="휴대폰 시험 MCP MCP 연결"]')); assert.equal(r.engine.accounts().length, 0); assert.equal(p.record.calls, 1); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await r.close(); await p.close(); }
});

test('mobile MCP preset fills official Toss settings, keeps Daangn registration pending and clears settings on manual input', async () => {
  const r = await createRuntime({ dataDir: tempDir('mcp-preset-ui'), port: 0, vault: new TestVault(), bootstrapCode: 'mcp-preset-ui-setup', evidenceMode: 'mock' });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: (process.env.KOREAI_TEST_BROWSER_CHANNEL ?? browserDefaults().channel) as BrowserChannel, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${r.baseUrl}/#setup=mcp-preset-ui-setup`); await page.getByRole('button', { name: '로컬 엔진 연결' }).click();
    await page.getByRole('button', { name: '에이전트 연결', exact: false }).first().click(); await page.getByRole('button', { name: '＋ 서버 연결' }).click();
    await page.getByLabel('연결할 MCP 서버', { exact: false }).selectOption('toss-console');
    assert.equal(await page.getByLabel('연결 이름', { exact: true }).inputValue(), '토스 운영 콘솔');
    assert.equal(await page.getByLabel('MCP 서버 주소', { exact: true }).inputValue(), 'https://mcp.toss.im/adapters/apps-in-toss-console/mcp');
    assert.equal(await page.getByLabel('MCP 서버 주소', { exact: true }).getAttribute('readonly'), '');
    assert.equal(await page.getByLabel('가져올 도구 이름 · 쉼표로 구분').inputValue(), 'workspace_list');
    assert(await page.getByLabel('인증 방식', { exact: false }).isDisabled());
    await page.getByText('등록된 OAuth 클라이언트·권한 설정', { exact: true }).click();
    assert.equal(await page.getByLabel('OAuth Client ID', { exact: true }).inputValue(), 'mcp-gateway');
    assert.equal(await page.getByLabel('예상 인증 서버 주소', { exact: true }).inputValue(), 'https://mcp.toss.im');
    assert.equal(await page.getByLabel('요청할 OAuth 권한 · 공백으로 구분').inputValue(), 'openid');
    assert((await page.getByRole('region', { name: '토스 콘솔 연결 조건' }).innerText()).includes('실제 계정 호환성은 확인 대기'));
    await page.getByText('당근 광고 MCP 연결 조건', { exact: true }).click(); assert((await page.locator('.remote-research').innerText()).includes('자동 프리셋 연결은 대기'));
    let attempted = 0;
    await page.route('**/api/remotes/oauth/start', async route => {
      attempted++; const body = route.request().postDataJSON(); assert.equal(body.presetId, 'toss-console'); assert.equal(body.oauth.clientId, 'mcp-gateway'); assert.deepEqual(body.tools, ['workspace_list']);
      await route.fulfill({ status: 409, json: { error: { code: 'OWNED_TEST_STOP', message: '시험에서 공급자 로그인 요청을 중단했습니다.' } } });
    });
    await page.getByRole('button', { name: 'OAuth 로그인 준비', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '시험에서 공급자 로그인 요청을 중단했습니다.' }).waitFor();
    assert.equal(attempted, 1); assert.equal(r.remote.list().length, 0); assert.equal(r.engine.accounts().length, 0); assert.equal(r.engine.metrics().verifiedServices, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); assert.deepEqual(errors, []);
    const screenshots = resolve('.test-data/screenshots'); mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: resolve(screenshots, 'mcp-preset-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: resolve(screenshots, 'mcp-preset-desktop.png'), fullPage: true });
    await page.getByLabel('OAuth Client Secret', { exact: true }).fill('owned-test-secret');
    await page.getByLabel('연결할 MCP 서버', { exact: false }).selectOption('');
    for (const name of ['연결 이름', 'MCP 서버 주소', 'OAuth Client ID', 'OAuth Client Secret', '예상 인증 서버 주소']) assert.equal(await page.getByLabel(name, { exact: true }).inputValue(), '');
    assert(await page.getByLabel('인증 방식', { exact: false }).isEnabled()); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await r.close(); }
});
