import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { ActionError } from '../types.js';

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(ip, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6'); blocked.addSubnet('2002::', 16, 'ipv6'); blocked.addSubnet('2001::', 32, 'ipv6');
export function publicOAuthAddress(ip: string): boolean {
  const family = isIP(ip); return family === 4 ? !blocked.check(ip, 'ipv4') : family === 6 && globalV6.check(ip, 'ipv6') && !blocked.check(ip, 'ipv6');
}
const hostname = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');
const loopback = (host: string) => ['127.0.0.1', 'localhost', '::1'].includes(host);
export function oauthUrl(value: string | URL): URL {
  let url: URL; try { url = new URL(value); } catch { throw new ActionError('OAUTH_URL', '올바른 OAuth 주소가 필요합니다.'); }
  if (url.username || url.password || url.hash || url.search || !(url.protocol === 'https:' || url.protocol === 'http:' && loopback(hostname(url)))) throw new ActionError('OAUTH_URL', 'OAuth 주소는 인증정보·쿼리 없는 HTTPS 또는 루프백 HTTP여야 합니다.');
  return url;
}

/** OAuth JSON requests only. DNS is checked and pinned to the actual socket; redirects are never followed. */
export function oauthFetch(serverAddress: string): typeof fetch {
  const server = oauthUrl(serverAddress);
  return async (input, init) => {
    const request = new Request(input, init), url = oauthUrl(request.url), host = hostname(url);
    const local = loopback(host) && loopback(hostname(server)) && url.origin === server.origin;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    signal.throwIfAborted();
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      lookup(host, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => local ? !['127.0.0.1', '::1'].includes(item.address) : !publicOAuthAddress(item.address))) throw new ActionError('OAUTH_NETWORK', 'OAuth 주소가 허용된 공개 주소 또는 같은 루프백 서버가 아닙니다.');
    const address = addresses[0]!;
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    if (body && body.length > 256 * 1024) throw new ActionError('OAUTH_SIZE', 'OAuth 요청이 너무 큽니다.');
    const outgoing: Record<string, string> = {}; request.headers.forEach((value, key) => { outgoing[key] = value; });
    return new Promise<Response>((resolve, reject) => {
      const pending = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: request.method, headers: { ...outgoing, 'accept-encoding': 'identity' }, agent: false,
        family: address.family, lookup: (_host, options, done) => options.all ? done(null, [{ address: address.address, family: address.family }]) : done(null, address.address, address.family), signal,
      }, response => {
        const headers = new Headers(); for (const [key, value] of Object.entries(response.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const status = response.statusCode ?? 500;
        if (status >= 300 && status < 400) { response.destroy(); reject(new ActionError('OAUTH_REDIRECT', 'OAuth 서버의 HTTP 리디렉션은 허용하지 않습니다.')); return; }
        if (request.method === 'GET' && headers.get('content-type')?.startsWith('text/event-stream')) { resolve(new Response(null, { status, headers })); response.destroy(); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) response.destroy(new Error('OAuth response limit')); else chunks.push(chunk); });
        response.on('error', reject); response.on('end', () => resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers })));
      });
      pending.on('error', reject); pending.end(body);
    });
  };
}
