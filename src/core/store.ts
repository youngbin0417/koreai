import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Job } from '../types.js';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, idem TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(client_id,idem));
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);`);
  }
  get<T>(kind: string, id: string): T | undefined {
    const r = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id) as { body: string } | undefined;
    return r ? JSON.parse(r.body) as T : undefined;
  }
  list<T>(kind: string): T[] {
    return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as { body: string }[]).map(r => JSON.parse(r.body) as T);
  }
  put(kind: string, id: string, body: unknown): void {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, id, JSON.stringify(body));
  }
  delete(kind: string, id: string): void { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  job(id: string): Job | undefined {
    const r = this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id) as { body: string } | undefined;
    return r ? JSON.parse(r.body) as Job : undefined;
  }
  jobs(): Job[] { return (this.db.prepare('SELECT body FROM jobs ORDER BY rowid DESC LIMIT 1000').all() as { body: string }[]).map(r => JSON.parse(r.body) as Job); }
  allJobs(): Job[] { return (this.db.prepare('SELECT body FROM jobs').all() as { body: string }[]).map(r => JSON.parse(r.body) as Job); }
  findRequest(client: string, key: string): Job | undefined {
    const r = this.db.prepare('SELECT body FROM jobs WHERE client_id=? AND idem=?').get(client, key) as { body: string } | undefined;
    return r ? JSON.parse(r.body) as Job : undefined;
  }
  insertJob(job: Job): void { this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(job.id, job.clientId, job.idempotencyKey, JSON.stringify(job)); }
  saveJob(job: Job): void { this.db.prepare('UPDATE jobs SET body=? WHERE id=?').run(JSON.stringify(job), job.id); }
  close(): void { this.db.close(); }
}
