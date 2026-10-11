import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformVault } from '../core/linux-vault.js';
import type { Vault } from '../core/security.js';

export const DEEPSEEK_MODEL = 'deepseek-flash' as const;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com' as const;
interface Credentials { version: 1; provider: 'deepseek'; model: typeof DEEPSEEK_MODEL; sealed: string }
export class DeepSeekCredentials {
  readonly path: string;
  private vault: Vault;
  constructor(dataDir = resolve('.koreai'), vault?: Vault) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      const directory = lstatSync(dataDir);
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid!() || (directory.mode & 0o077) !== 0) throw new Error('DeepSeek 데이터 폴더는 현재 사용자 소유이며 권한은 700이어야 합니다.');
    }
    this.path = join(dataDir, 'deepseek.secret.json');
    this.vault = vault ?? createPlatformVault(dataDir, process.env.KOREAI_MASTER_KEY_FILE, { allowCreate: !existsSync(this.path) });
  }
  private checkFile() {
    const stat = lstatSync(this.path);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0))) {
      throw new Error('DeepSeek 비밀정보 파일은 현재 사용자 소유의 일반 파일이며 권한은 600이어야 합니다.');
    }
  }
  async save(apiKey: string) {
    if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(apiKey)) throw new Error('DeepSeek API 키 형식을 확인하세요.');
    if (existsSync(this.path)) this.checkFile();
    const value: Credentials = { version: 1, provider: 'deepseek', model: DEEPSEEK_MODEL, sealed: await this.vault.seal({ apiKey }) };
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, this.path);
  }
  async load(): Promise<string> {
    if (!existsSync(this.path)) throw new Error('DeepSeek 키가 없습니다. npm run ai:key로 등록하세요.');
    this.checkFile();
    const value = JSON.parse(readFileSync(this.path, 'utf8')) as Credentials;
    if (value.version !== 1 || value.provider !== 'deepseek' || value.model !== DEEPSEEK_MODEL || typeof value.sealed !== 'string') throw new Error('DeepSeek 설정 형식을 확인하세요.');
    const secrets = await this.vault.open(value.sealed);
    if (!/^sk-[A-Za-z0-9_-]{16,200}$/.test(secrets.apiKey ?? '')) throw new Error('저장된 DeepSeek 키 형식을 확인하세요.');
    return secrets.apiKey;
  }
}
