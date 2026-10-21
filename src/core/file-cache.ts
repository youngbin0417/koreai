import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { ActionError } from '../types.js';

const posix = process.platform !== 'win32';
export const fileCacheLimits = { maxBytes: 64_000_000, maxEntryBytes: 32_000_000, maxEntries: 3, ttlMs: 7 * 24 * 60 * 60 * 1000 } as const;
interface Limits { maxBytes: number; maxEntryBytes: number; maxEntries: number; ttlMs: number }
const metadataSchema = z.object({ version: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(), downloadedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  providerLastModifiedRaw: z.string().max(512).nullable() }).strict();
type Metadata = z.infer<typeof metadataSchema>;
export interface DownloadedFile { bytes: Uint8Array; providerLastModifiedRaw: string | null }
export interface CachedFile extends DownloadedFile { cache: { status: 'hit' | 'downloaded' | 'shared'; downloadedAt: string; expiresAt: string; byteLength: number; sha256: string } }
interface Waiter { dispatched: boolean; deliver: (result: CachedFile) => void; fail: (error: unknown) => void; dispatch: () => void }
interface Flight { controller: AbortController; waiters: Set<Waiter>; downloading: boolean; task: Promise<void>; first: Waiter | undefined }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cancelled = () => new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
const unsafe = () => new ActionError('CACHE_UNSAFE_PATH', '파일 캐시 경로·파일 종류·소유권 또는 접근 권한을 확인하세요.');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** An engine owns this directory exclusively. Only validated public files enter it. */
export class VerifiedFileCache {
  readonly directory: string;
  private limits: Limits;
  private io: Promise<unknown> = Promise.resolve();
  private flights = new Map<string, Flight>();
  private closed = false;
  constructor(directory: string, limits: Partial<Limits> = {}) {
    this.directory = resolve(directory); this.limits = { ...fileCacheLimits, ...limits };
    if (Object.values(this.limits).some(v => !Number.isSafeInteger(v) || v <= 0) || this.limits.maxEntryBytes + 8192 > this.limits.maxBytes) throw new Error('Invalid file cache limits');
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.io.then(run); this.io = result.catch(() => {}); return result;
  }
  private async directoryCheck() {
    try { await mkdir(this.directory, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || posix && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)) throw unsafe();
  }
  private async read(name: string, maxBytes: number): Promise<Buffer | null> {
    const path = join(this.directory, name);
    let before; try { before = await lstat(path); } catch (e) { if (missing(e)) return null; throw e; }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || posix && (before.uid !== process.getuid!() || (before.mode & 0o077) !== 0)) throw unsafe();
    if (before.size > maxBytes) return null;
    const file = await open(path, constants.O_RDONLY | (posix ? constants.O_NOFOLLOW : 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1) throw unsafe();
      if (stat.size > maxBytes) return null;
      const bytes = Buffer.alloc(stat.size + 1); let count = 0;
      while (count < bytes.length) { const part = await file.read(bytes, count, bytes.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; }
      return count === stat.size ? bytes.subarray(0, count) : null;
    } finally { await file.close(); }
  }
  private async remove(name: string) {
    const path = join(this.directory, name);
    try { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw unsafe(); await unlink(path); }
    catch (error) { if (!missing(error)) throw error; }
  }
  private async discard(key: string) { await this.remove(key + '.json'); await this.remove(key + '.bin'); }
  private async metadata(key: string): Promise<Metadata | null> {
    const bytes = await this.read(key + '.json', 4096); if (!bytes) return null;
    try {
      const meta = metadataSchema.parse(JSON.parse(bytes.toString('utf8'))), now = Date.now();
      return meta.key === key && meta.size <= this.limits.maxEntryBytes && meta.expiresAt - meta.downloadedAt === this.limits.ttlMs && meta.downloadedAt <= now && meta.expiresAt > now ? meta : null;
    } catch { return null; }
  }
  private async inventory() {
    await this.directoryCheck(); const names = await readdir(this.directory);
    if (names.length > 256) throw new ActionError('CACHE_TOO_MANY_FILES', '캐시 파일 수를 확인하세요.');
    const keys = new Set<string>();
    for (const name of names) {
      if (/^\.[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name)) { await this.remove(name); continue; }
      if (!/^[a-f0-9]{64}\.(?:json|bin)$/.test(name)) throw unsafe();
      keys.add(name.slice(0, 64));
    }
    const entries: { meta: Metadata; diskBytes: number }[] = [];
    for (const key of keys) {
      const meta = await this.metadata(key);
      let body; try { body = await lstat(join(this.directory, key + '.bin')); } catch (e) { if (!missing(e)) throw e; }
      if (body && (!body.isFile() || body.isSymbolicLink() || body.nlink !== 1 || posix && (body.uid !== process.getuid!() || (body.mode & 0o077) !== 0))) throw unsafe();
      if (!meta || !body || body.size !== meta.size) { await this.discard(key); continue; }
      entries.push({ meta, diskBytes: body.size + (await lstat(join(this.directory, key + '.json'))).size });
    }
    return entries.sort((a, b) => a.meta.downloadedAt - b.meta.downloadedAt || a.meta.key.localeCompare(b.meta.key));
  }
  private async prune(reserve = 0, reserveEntries = 0) {
    const entries = await this.inventory(); let size = entries.reduce((n, e) => n + e.diskBytes, 0), count = entries.length;
    for (const entry of entries) {
      if (size + reserve <= this.limits.maxBytes && count + reserveEntries <= this.limits.maxEntries) break;
      await this.discard(entry.meta.key); size -= entry.diskBytes; count--;
    }
  }
  async prepare() { await this.serial(() => this.prune()); }
  private async cached(key: string): Promise<CachedFile | null> {
    await this.prune(); const meta = await this.metadata(key); if (!meta) return null;
    const bytes = await this.read(key + '.bin', this.limits.maxEntryBytes);
    if (!bytes || bytes.length !== meta.size || hash(bytes) !== meta.sha256) { await this.discard(key); return null; }
    return this.result(bytes, meta, 'hit');
  }
  private result(bytes: Uint8Array, meta: Metadata, status: CachedFile['cache']['status']): CachedFile {
    return { bytes, providerLastModifiedRaw: meta.providerLastModifiedRaw, cache: { status, downloadedAt: new Date(meta.downloadedAt).toISOString(), expiresAt: new Date(meta.expiresAt).toISOString(), byteLength: meta.size, sha256: meta.sha256 } };
  }
  private async publish(key: string, data: DownloadedFile, signal: AbortSignal) {
    if (signal.aborted) throw cancelled();
    if (!data.bytes.length || data.bytes.length > this.limits.maxEntryBytes) throw new ActionError('RESULT_TOO_LARGE', '캐시 파일 크기 상한을 초과했습니다.');
    const downloadedAt = Date.now(), meta: Metadata = { version: 1, key, sha256: hash(data.bytes), size: data.bytes.length, downloadedAt, expiresAt: downloadedAt + this.limits.ttlMs, providerLastModifiedRaw: data.providerLastModifiedRaw?.slice(0, 512) ?? null };
    const json = Buffer.from(JSON.stringify(meta));
    // Budget covers final data + metadata and a temporary metadata copy.
    await this.prune(data.bytes.length + json.length * 2, 1); await this.discard(key);
    const temp = '.' + key + '.' + randomUUID() + '.tmp'; let bodyPublished = false, committed = false;
    const write = async (name: string, bytes: Uint8Array) => { const f = await open(join(this.directory, name), 'wx', 0o600); try { await f.writeFile(bytes); await f.sync(); } finally { await f.close(); } };
    try {
      await write(temp, data.bytes); if (signal.aborted) throw cancelled();
      await rename(join(this.directory, temp), join(this.directory, key + '.bin')); bodyPublished = true;
      await write(temp, json); if (signal.aborted) throw cancelled();
      await rename(join(this.directory, temp), join(this.directory, key + '.json')); committed = true;
      return this.result(data.bytes, meta, 'downloaded');
    } finally { await this.remove(temp); if (bodyPublished && !committed) await this.discard(key); }
  }
  getOrLoad(key: string, signal: AbortSignal, load: (signal: AbortSignal) => Promise<DownloadedFile>, dispatch: () => void): Promise<CachedFile> {
    if (!/^[a-f0-9]{64}$/.test(key)) return Promise.reject(unsafe());
    if (this.closed || signal.aborted) return Promise.reject(cancelled());
    let flight = this.flights.get(key);
    if (!flight || flight.controller.signal.aborted) {
      const current: Flight = { controller: new AbortController(), waiters: new Set(), downloading: false, task: Promise.resolve(), first: undefined };
      flight = current; this.flights.set(key, current);
      current.task = Promise.resolve().then(async () => {
        const cached = await this.serial(() => this.cached(key)); if (current.controller.signal.aborted) throw cancelled();
        if (cached) return cached;
        current.downloading = true;
        for (const waiter of [...current.waiters]) this.dispatch(current, waiter);
        if (current.controller.signal.aborted) throw cancelled();
        const data = await load(current.controller.signal); if (current.controller.signal.aborted) throw cancelled();
        return this.serial(() => this.publish(key, data, current.controller.signal));
      }).then(result => { for (const waiter of [...current.waiters]) waiter.deliver({ ...result, cache: { ...result.cache, status: result.cache.status === 'hit' ? 'hit' : waiter === current.first ? 'downloaded' : 'shared' } }); }, error => {
        const safe = error instanceof ActionError ? error : new ActionError('CACHE_IO_ERROR', '공개 파일 캐시를 읽거나 저장하지 못했습니다. 디스크와 접근 권한을 확인하세요.');
        for (const waiter of [...current.waiters]) waiter.fail(safe);
      }).finally(() => { if (this.flights.get(key) === current) this.flights.delete(key); });
    }
    const current = flight;
    return new Promise((resolveResult, reject) => {
      const detach = () => { signal.removeEventListener('abort', abort); current.waiters.delete(waiter); if (!current.waiters.size) current.controller.abort(); };
      const waiter: Waiter = { dispatched: false, dispatch, deliver: result => { detach(); resolveResult(result); }, fail: error => { detach(); reject(error); } };
      const abort = () => waiter.fail(cancelled());
      current.waiters.add(waiter); current.first ??= waiter; signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else if (current.downloading) this.dispatch(current, waiter);
    });
  }
  private dispatch(flight: Flight, waiter: Waiter) {
    if (waiter.dispatched || !flight.waiters.has(waiter)) return;
    try { waiter.dispatch(); waiter.dispatched = true; } catch (error) { waiter.fail(error); }
  }
  async close() { this.closed = true; for (const flight of this.flights.values()) flight.controller.abort(); await Promise.all([...this.flights.values()].map(f => f.task)); await this.io; }
}
