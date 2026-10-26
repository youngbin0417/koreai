import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createRuntime } from '../src/http.js';
import { browserDefaults, type BrowserChannel } from '../src/core/platform.js';
import { MOTIF_MODEL } from '../src/ai/providers.js';
import { TestVault, tempDir } from './helpers.js';

const deepseekKey = 'sk-mobile-ui-private-123456789';
const morphKey = 'morph-ui-private-1234567890';

test('mobile chat picks Motif or DeepSeek per conversation, reports env management and never shows keys', async () => {
  const requests: { host: string; body: any }[] = [];
  const aiFetcher: typeof fetch = async (url, init) => {
    const host = new URL(String(url)).host;
    requests.push({ host, body: JSON.parse(String(init?.body)) });
    return host === 'api-cbt.morphfactory.io'
      ? Response.json({ model: MOTIF_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '모티프 응답입니다.' } }] })
      : Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '딥시크 응답입니다.', reasoning_content: 'internal private reasoning' } }] });
  };
  const r = await createRuntime({ dataDir: tempDir('motif-ui'), port: 0, vault: new TestVault(), bootstrapCode: 'motif-ui-bootstrap', evidenceMode: 'mock', aiFetcher,
    environment: { MORPH_API_KEY: morphKey, DEEPSEEK_API_KEY: deepseekKey } });
  const browser = await chromium.launch({ channel: (process.env.KOREAI_TEST_BROWSER_CHANNEL ?? browserDefaults().channel) as BrowserChannel, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const waitForRequests = async (count: number) => {
      const until = Date.now() + 20_000;
      while (requests.length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(requests.length, count, `expected ${count} provider requests, saw ${requests.length}`);
    };
    await page.goto(`${r.baseUrl}/#setup=motif-ui-bootstrap`); await page.getByRole('button', { name: '엔진 연결' }).click();
    const picker = page.getByLabel('AI 공급자', { exact: true });
    await picker.waitFor();
    assert.equal(await picker.inputValue(), 'deepseek');
    assert.equal(await picker.getByRole('option', { name: 'DeepSeek · deepseek-flash', exact: true }).count(), 1);
    assert.equal(await picker.getByRole('option', { name: `Motif · ${MOTIF_MODEL}`, exact: true }).count(), 1);
    await page.getByText('시작할 공급자: DeepSeek · deepseek-flash', { exact: true }).waitFor();
    await page.getByText('DeepSeek 키는 .env의 DEEPSEEK_API_KEY로 관리합니다.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'AI 키 변경', exact: true }).count(), 0);
    // Motif is chosen explicitly and keeps its environment-managed key notice.
    await picker.selectOption('motif');
    await page.getByText('Motif 키는 .env의 MORPH_API_KEY로 관리합니다.', { exact: false }).waitFor();
    await page.getByLabel('보낼 메시지', { exact: true }).fill('모티프에게 인사');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await waitForRequests(1);
    await page.getByText('모티프 응답입니다.', { exact: true }).waitFor();
    assert.equal(requests[0]!.host, 'api-cbt.morphfactory.io');
    assert.equal(requests[0]!.body.model, MOTIF_MODEL);
    assert.equal(await page.getByRole('option', { name: /· Motif$/ }).count(), 1);
    // A new conversation can use the default provider, and each chat keeps its own choice.
    await page.getByRole('button', { name: '＋ 새 대화', exact: true }).click();
    await page.getByLabel('AI 공급자', { exact: true }).selectOption('deepseek');
    await page.getByLabel('보낼 메시지', { exact: true }).fill('딥시크에게 인사');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await waitForRequests(2);
    await page.getByText('딥시크 응답입니다.', { exact: true }).waitFor();
    assert.equal(requests[1]!.host, 'api.deepseek.com');
    assert.equal(requests[1]!.body.model, 'deepseek-flash');
    await page.getByLabel('대화 기록', { exact: true }).selectOption({ label: '모티프에게 인사 · Motif' });
    await page.getByText('대화 공급자: Motif · ' + MOTIF_MODEL, { exact: true }).waitFor();
    assert.equal(await page.getByLabel('AI 공급자', { exact: true }).count(), 0);
    await page.getByLabel('보낼 메시지', { exact: true }).fill('모티프 계속');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await waitForRequests(3);
    assert.equal(requests[2]!.host, 'api-cbt.morphfactory.io');
    assert.equal(requests[2]!.body.model, MOTIF_MODEL);
    await page.getByText('모티프 응답입니다.', { exact: true }).nth(1).waitFor();
    const body = await page.locator('body').innerText();
    assert(!body.includes(morphKey)); assert(!body.includes(deepseekKey)); assert(!body.includes('internal private reasoning'));
    assert.deepEqual(errors, []);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(JSON.stringify(r.store.list('chat')).includes(morphKey), false);
  } finally { await browser.close(); await r.close(); }
});
