import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { defaultMasterKeyFile } from './core/linux-vault.js';
import { serverOptions } from './core/platform.js';
import { loadProjectEnv } from './core/project-env.js';

const environment = loadProjectEnv();
const { values } = parseArgs({ options: { 'browser-smoke': { type: 'boolean', default: false }, 'data-dir': { type: 'string', default: '.koreai' }, channel: { type: 'string' } } });
const options = serverOptions(['--data-dir', values['data-dir']!, ...(values.channel ? ['--channel', values.channel] : [])], environment);
const report: Record<string, unknown> = {
  platform: process.platform, node: process.version, dataDir: options.dataDir,
  built: existsSync(resolve('dist/server.js')) && existsSync(resolve('web-dist/index.html')),
  database: existsSync(join(options.dataDir, 'koreai.sqlite')),
  vault: process.platform === 'win32' ? 'Windows DPAPI' : 'AES-256-GCM',
  ...(process.platform === 'win32' ? {} : { masterKeyFile: options.masterKeyFile ?? defaultMasterKeyFile() }),
  browser: { channel: options.channel, headless: options.headless, chromiumInstalled: existsSync(chromium.executablePath()) },
  deepseek: { configured: !!environment.DEEPSEEK_API_KEY?.trim() || existsSync(join(options.dataDir, 'deepseek.secret.json')), model: 'deepseek-flash' },
};
if (values['browser-smoke']) {
  try { const browser = await chromium.launch({ channel: options.channel, headless: true }); await browser.close(); report.browserSmoke = 'passed'; }
  catch { report.browserSmoke = 'failed'; report.help = 'npx playwright install --with-deps chromium'; process.exitCode = 1; }
}
console.log(JSON.stringify(report, null, 2));
