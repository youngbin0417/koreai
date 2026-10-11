import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants, existsSync, lstatSync } from 'node:fs';
import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WindowsVault, type Vault } from './security.js';

const AAD = Buffer.from('KoreAI secret vault v1', 'utf8');
const MAX_SECRET_BYTES = 256 * 1024;
const posix = process.platform !== 'win32';
const missingKey = () => new Error('마스터 키가 없습니다. 기존 키를 복원한 뒤 다시 시작하세요. 새 키로 기존 비밀정보를 복구할 수 없습니다.');
const unsafeKey = () => new Error('마스터 키와 보관 디렉터리는 현재 사용자 소유의 일반 파일·디렉터리여야 하며, Linux에서는 권한을 각각 600·700으로 설정해야 합니다. 심볼릭 링크는 허용하지 않습니다.');
const invalidEnvelope = () => new Error('비밀정보 복호화에 실패했습니다. 올바른 마스터 키와 손상되지 않은 데이터를 사용하세요.');

export interface FileVaultOptions { allowCreate?: boolean }

/** XDG_CONFIG_HOME must be absolute. The encryption key stays outside the default data directory. */
export function defaultMasterKeyFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'koreai', 'master.key');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
}

/**
 * Headless Linux vault. AES-GCM encrypts database values; filesystem permissions protect
 * the independent master key. This is not a desktop keyring or hardware-backed vault.
 */
export class FileVault implements Vault {
  readonly keyFile: string;
  private keyPromise?: Promise<Buffer>;
  constructor(keyFile: string, private readonly options: FileVaultOptions = {}) {
    this.keyFile = resolve(keyFile);
  }

  private async checkDirectory(): Promise<void> {
    const stat = await lstat(dirname(this.keyFile));
    if (!stat.isDirectory() || stat.isSymbolicLink() || (posix && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0))) throw unsafeKey();
  }

  private async readKey(): Promise<Buffer> {
    await this.checkDirectory();
    const before = await lstat(this.keyFile);
    if (!before.isFile() || before.isSymbolicLink()) throw unsafeKey();
    const file = await open(this.keyFile, constants.O_RDONLY | (posix ? constants.O_NOFOLLOW : 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || (posix && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0))) throw unsafeKey();
      if (stat.size !== 32) throw new Error('마스터 키 파일이 손상되었습니다. 원래 키의 백업을 복원하세요.');
      const key = await file.readFile();
      if (key.length !== 32) throw new Error('마스터 키 파일이 손상되었습니다. 원래 키의 백업을 복원하세요.');
      return key;
    } finally { await file.close(); }
  }

  private async createKey(): Promise<Buffer> {
    await mkdir(dirname(this.keyFile), { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    // Publish a complete, fsynced file atomically. link() never replaces an existing key.
    const temporary = join(dirname(this.keyFile), `.${basename(this.keyFile)}.${randomUUID()}.tmp`);
    let handle: FileHandle | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(randomBytes(32));
      await handle.sync();
      await handle.close(); handle = undefined;
      try { await link(temporary, this.keyFile); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(() => {});
    }
    return this.readKey();
  }

  private key(create: boolean): Promise<Buffer> {
    this.keyPromise ??= (async () => {
      try { return await this.readKey(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create || this.options.allowCreate === false) throw missingKey();
        return this.createKey();
      }
    })();
    return this.keyPromise;
  }

  async seal(value: Record<string, string>): Promise<string> {
    if (!isStringRecord(value)) throw new Error('비밀정보 형식이 올바르지 않습니다.');
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    if (plaintext.length > MAX_SECRET_BYTES) throw new Error('비밀정보 크기 제한을 초과했습니다.');
    try {
      const key = await this.key(true);
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(AAD);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return ['koreai', 'v1', nonce.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':');
    } finally { plaintext.fill(0); }
  }

  async open(value: string): Promise<Record<string, string>> {
    if (value.length > MAX_SECRET_BYTES * 2) throw invalidEnvelope();
    const parts = value.split(':');
    if (parts.length !== 5 || parts[0] !== 'koreai' || parts[1] !== 'v1' || !parts.slice(2).every(p => /^[A-Za-z0-9_-]+$/.test(p))) throw invalidEnvelope();
    const [nonce, encrypted, tag] = parts.slice(2).map(p => Buffer.from(p, 'base64url'));
    if (nonce.length !== 12 || tag.length !== 16 || parts.slice(2).some((p, i) => [nonce, encrypted, tag][i].toString('base64url') !== p)) throw invalidEnvelope();
    // Decryption never creates a new master key, even on an otherwise empty installation.
    const key = await this.key(false);
    let plaintext: Buffer | undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(AAD); decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      const decoded: unknown = JSON.parse(plaintext.toString('utf8'));
      if (!isStringRecord(decoded)) throw invalidEnvelope();
      return decoded;
    } catch { throw invalidEnvelope(); }
    finally { plaintext?.fill(0); }
  }
}

function hasEncryptedRecords(dataDir: string): boolean {
  const path = join(dataDir, 'koreai.sqlite');
  if (!existsSync(path)) return false;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const rows = database.prepare('SELECT body FROM records').all() as { body: string }[];
    return rows.some(row => typeof (JSON.parse(row.body) as { sealed?: unknown }).sealed === 'string');
  } catch { throw new Error('기존 비밀정보 저장 상태를 확인할 수 없어 마스터 키 생성을 중단했습니다. 데이터베이스를 확인하세요.'); }
  finally { database?.close(); }
}

/** Only an empty secret store may create a key. A restored database requires its original key. */
export function createPlatformVault(dataDir: string, keyFile = defaultMasterKeyFile(), options: FileVaultOptions = {}): Vault {
  if (process.platform === 'win32') return new WindowsVault();
  const existingSecrets = hasEncryptedRecords(dataDir);
  if (existingSecrets) {
    try {
      const directory = lstatSync(dirname(resolve(keyFile))); const key = lstatSync(resolve(keyFile));
      if (!directory.isDirectory() || directory.isSymbolicLink() || !key.isFile() || key.isSymbolicLink() ||
          directory.uid !== process.getuid!() || key.uid !== process.getuid!() || ((directory.mode | key.mode) & 0o077) !== 0) throw unsafeKey();
      if (key.size !== 32) throw new Error('마스터 키 파일이 손상되었습니다. 원래 키의 백업을 복원하세요.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missingKey();
      throw error;
    }
  }
  return new FileVault(keyFile, { allowCreate: existingSecrets ? false : options.allowCreate ?? true });
}
