import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { loadProjectEnv } from '../src/core/project-env.js';
import { environmentProviders, environmentKeyName } from '../src/core/env-accounts.js';
import { DeepSeekCredentials } from '../src/ai/credentials.js';
import { tempDir, TestVault } from './helpers.js';

test('project dotenv loads only server settings, supports quoted keys and preserves shell values without mutation', () => {
  const dir = tempDir('dotenv'), base = { KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY: 'shell-key', KOREAI_TOKEN: '' };
  writeFileSync(join(dir, '.env'), 'KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY="file+/=key"\nDEEPSEEK_API_KEY="sk-test-env-1234567890"\nKOREAI_TOKEN=file-token\nNODE_OPTIONS=--inspect\nVITE_PRIVATE_KEY=must-not-load\n');
  const env = loadProjectEnv(base, dir); assert.equal(env.KOREAI_SEOUL_SUBWAY_ROUTE_SERVICE_KEY, 'shell-key'); assert.equal(env.KOREAI_TOKEN, ''); assert.equal(env.DEEPSEEK_API_KEY, 'sk-test-env-1234567890'); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.VITE_PRIVATE_KEY, undefined); assert.equal(Object.keys(base).length, 2);
  assert.deepEqual(loadProjectEnv({ KOREAI_URL: 'http://127.0.0.1:4318' }, tempDir('no-env')), { KOREAI_URL: 'http://127.0.0.1:4318' });
  writeFileSync(join(dir, 'server.env'), 'KOREAI_SEOUL_SUBWAY_API_KEY=separate-key'); assert.equal(loadProjectEnv({ KOREAI_ENV_FILE: 'server.env' }, dir).KOREAI_SEOUL_SUBWAY_API_KEY, 'separate-key');
  assert.throws(() => loadProjectEnv({ KOREAI_ENV_FILE: 'missing.env' }, dir), /환경변수 파일/);
});

test('dotenv examples contain blank secret fields and Git excludes real variants while permitting only the example', () => {
  const env = parseEnv(readFileSync('.env.example', 'utf8')); assert.equal(env.DEEPSEEK_API_KEY, '');
  for (const [, prefix, , fields] of environmentProviders) for (const field of fields) assert.equal(env[environmentKeyName(prefix, field)], '');
  const ignored = execFileSync('git', ['check-ignore', '.env', '.env.local', '.env.production', '.env.backup', '.env.example'], { encoding: 'utf8' }).trim().split(/\r?\n/); assert.deepEqual(ignored, ['.env', '.env.local', '.env.production', '.env.backup']);
});

test('DeepSeek dotenv key takes precedence without rewriting the encrypted key or falling back from an invalid env key', async () => {
  const dir = tempDir('env-deepseek'), vault = new TestVault(), old = new DeepSeekCredentials(dir, vault);
  await old.save('sk-old-unit-key-123456789'); const bytes = readFileSync(old.path, 'utf8');
  const key = 'sk-env-unit-key-123456789', credentials = new DeepSeekCredentials(dir, vault, { DEEPSEEK_API_KEY: key });
  assert.equal(await credentials.load(), key); assert.equal(credentials.source, 'environment'); assert(credentials.configured); assert.equal(readFileSync(old.path, 'utf8'), bytes); await assert.rejects(() => credentials.save('sk-replacement-test-key'), /\.env/);
  await assert.rejects(() => new DeepSeekCredentials(dir, vault, { DEEPSEEK_API_KEY: 'invalid' }).load(), /DEEPSEEK_API_KEY/);
  assert.equal(await new DeepSeekCredentials(dir, vault, { DEEPSEEK_API_KEY: '' }).load(), 'sk-old-unit-key-123456789');
  const fresh = new DeepSeekCredentials(tempDir('env-key-only'), vault, { DEEPSEEK_API_KEY: key }); assert.equal(await fresh.load(), key); assert(!existsSync(fresh.path));
});
