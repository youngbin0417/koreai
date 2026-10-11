import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileVault, createPlatformVault } from '../src/core/linux-vault.js';
import { Store } from '../src/core/store.js';
import { tempDir } from './helpers.js';

const secret = { accessToken: 'never-print-a-real-token', clientSecret: 'private-value' };
const keyPath = () => join(tempDir('linux-vault'), 'keys', 'master.key');

test('file vault encrypts with fresh nonces and survives a process restart', async () => {
  const path = keyPath(); const vault = new FileVault(path);
  const envelopes = await Promise.all([vault.seal(secret), vault.seal(secret)]);
  assert.notEqual(envelopes[0], envelopes[1]);
  assert.ok(envelopes.every(value => value.startsWith('koreai:v1:') && !value.includes(secret.accessToken)));
  assert.equal((await readFile(path)).length, 32);
  assert.deepEqual(await new FileVault(path, { allowCreate: false }).open(envelopes[0]), secret);
  assert.deepEqual(await vault.open(envelopes[1]), secret);
});

test('file vault rejects ciphertext tampering, unsupported versions, and a different master key', async () => {
  const path = keyPath(); const sealed = await new FileVault(path).seal(secret);
  const parts = sealed.split(':'); const ciphertext = Buffer.from(parts[3], 'base64url');
  ciphertext[0] ^= 1; parts[3] = ciphertext.toString('base64url');
  const original = new FileVault(path);
  await assert.rejects(() => original.open(parts.join(':')), /복호화/);
  await assert.rejects(() => original.open(sealed.replace('v1:', 'v2:')), /복호화/);
  const different = new FileVault(keyPath()); await different.seal({});
  await assert.rejects(() => different.open(sealed), error => error instanceof Error && !error.message.includes(secret.accessToken) && /복호화/.test(error.message));
});

test('decryption and an existing secret store cannot silently replace a lost key', async () => {
  const path = keyPath(); const sealed = await new FileVault(path).seal(secret);
  await unlink(path);
  await assert.rejects(() => new FileVault(path).open(sealed), /마스터 키가 없습니다/);
  await assert.rejects(() => new FileVault(path, { allowCreate: false }).seal(secret), /마스터 키가 없습니다/);
  await assert.rejects(() => readFile(path), { code: 'ENOENT' });
});

test('a truncated key fails closed instead of overwriting it', async () => {
  const path = keyPath(); await new FileVault(path).seal(secret);
  await writeFile(path, Buffer.alloc(4));
  await assert.rejects(() => new FileVault(path).seal(secret), /손상/);
  assert.equal((await readFile(path)).length, 4);
});

test('Linux platform vault detects persisted encrypted records before generating a key', { skip: process.platform === 'win32' }, async () => {
  const dataDir = tempDir('linux-vault-db'); const path = keyPath();
  const store = new Store(join(dataDir, 'koreai.sqlite'));
  try {
    const vault = createPlatformVault(dataDir, path); const sealed = await vault.seal(secret);
    store.put('account', 'persisted', { sealed }); await unlink(path);
    assert.throws(() => createPlatformVault(dataDir, path), /마스터 키가 없습니다/);
    await assert.rejects(() => readFile(path), { code: 'ENOENT' });
  } finally { store.close(); }
});

test('Linux master keys use private modes and reject symlinks and permissive files/directories', { skip: process.platform === 'win32' }, async () => {
  const path = keyPath(); await new FileVault(path).seal(secret);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, '..'))).mode & 0o777, 0o700);
  await chmod(path, 0o644);
  await assert.rejects(() => new FileVault(path).seal(secret), /600·700/);
  await chmod(path, 0o600); await chmod(join(path, '..'), 0o755);
  await assert.rejects(() => new FileVault(path).seal(secret), /600·700/);
  await chmod(join(path, '..'), 0o700);
  const linked = join(path, '..', 'linked.key'); await symlink(path, linked);
  await assert.rejects(() => new FileVault(linked).seal(secret), /심볼릭 링크/);
  const linkedDir = join(path, '..', '..', 'linked-directory'); await symlink(join(path, '..'), linkedDir);
  await assert.rejects(() => new FileVault(join(linkedDir, 'master.key')).seal(secret), /심볼릭 링크/);
});

test('an existing key path that is a directory is rejected', async () => {
  const path = keyPath(); await mkdir(path, { recursive: true, mode: 0o700 });
  await assert.rejects(() => new FileVault(path).seal(secret), /일반 파일/);
});
