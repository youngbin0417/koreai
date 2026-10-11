import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Principal } from '../types.js';

export interface Vault { seal(value: Record<string, string>): Promise<string>; open(value: string): Promise<Record<string, string>> }
/** Secrets go through stdin; command lines and PowerShell error output never contain them. */
export class WindowsVault implements Vault {
  private async transform(mode: 'seal' | 'open', data: string): Promise<string> {
    if (process.platform !== 'win32') throw new Error('현재 비밀정보 보관은 Windows DPAPI를 지원합니다.');
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $o=[Security.Cryptography.ProtectedData]::${mode === 'seal' ? 'Protect' : 'Unprotect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($o))`;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('비밀정보 저장소 응답 시간 초과')); }, 15_000);
      child.stdout.on('data', b => { out += b.toString(); });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('Windows 비밀정보 저장소를 실행할 수 없습니다.')); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error('비밀정보 복호화에 실패했습니다. 같은 Windows 사용자로 실행하세요.')); });
      child.stdin.on('error', () => {}); child.stdin.end(data);
    });
  }
  async seal(value: Record<string, string>): Promise<string> { return this.transform('seal', Buffer.from(JSON.stringify(value), 'utf8').toString('base64')); }
  async open(value: string): Promise<Record<string, string>> { return JSON.parse(Buffer.from(await this.transform('open', value), 'base64').toString('utf8')); }
}
export function token(): string { return randomBytes(32).toString('base64url'); }
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function constantEqual(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function canUse(principal: Principal, action: string): boolean { return principal.role === 'admin' || principal.allowedActions.includes(action); }
const sensitive = /^(access_?token|refresh_?token|id_?token|client_?secret|authorization|cookie|set-cookie|password|api_?key|service_?key|sealed)$/i;
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, sensitive.test(k) ? '[REDACTED]' : redact(v, secrets)]));
  if (typeof value === 'string') {
    let clean = value.replace(/((?:access_token|refresh_token|client_secret|serviceKey|api_key)=)[^&\s"']+/gi, '$1[REDACTED]');
    for (const secret of secrets.filter(s => s.length > 0).sort((a,b) => b.length-a.length)) {
      clean = clean.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
    }
    return clean;
  }
  return value;
}
