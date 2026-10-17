import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

export type BrowserChannel = 'chromium' | 'chrome' | 'msedge';
export function publicOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('외부 주소는 경로·인증정보가 없는 HTTPS 주소여야 합니다.');
  return url.origin;
}
export function browserDefaults(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env) {
  return {
    channel: (platform === 'win32' ? 'msedge' : 'chromium') as BrowserChannel,
    headless: platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY,
  };
}

export function serverOptions(args: string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  const { values } = parseArgs({ args, options: {
    port: { type: 'string', default: '4318' },
    'data-dir': { type: 'string', default: '.koreai' },
    channel: { type: 'string' },
    'master-key-file': { type: 'string' },
    'public-url': { type: 'string' },
    headless: { type: 'boolean' },
    headed: { type: 'boolean' },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  }, strict: true });
  const defaults = browserDefaults(platform, env);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('포트는 1024~65535 범위여야 합니다.');
  const channel = values.channel ?? defaults.channel;
  if (!['chromium', 'chrome', 'msedge'].includes(channel)) throw new Error('브라우저 채널은 chromium, chrome 또는 msedge입니다.');
  if (values.headless && values.headed) throw new Error('--headless와 --headed는 함께 사용할 수 없습니다.');
  const masterKeyFile = values['master-key-file'] ?? env.KOREAI_MASTER_KEY_FILE;
  return { port, dataDir: resolve(values['data-dir']!), channel: channel as BrowserChannel,
    headless: values.headed ? false : values.headless ?? defaults.headless,
    dev: values.dev, help: values.help, allowSeoulBikeHttp: env.KOREAI_ALLOW_SEOUL_BIKE_HTTP === '1', publicUrl: publicOrigin(values['public-url'] ?? env.KOREAI_PUBLIC_URL), ...(masterKeyFile ? { masterKeyFile: resolve(masterKeyFile) } : {}) };
}

export const serverHelp = `KoreAI 로컬 연결 엔진
사용법: npm start -- [옵션]
  --port 4318               루프백 HTTP 포트
  --data-dir .koreai         작업·계정 DB와 전용 브라우저 프로필
  --channel chromium        chromium | chrome | msedge
  --headless                화면 없이 브라우저 실행
  --headed                  그래픽 세션에서 브라우저 창 표시
  --master-key-file PATH    Linux AES-256-GCM 마스터 키 파일
  --public-url https://HOST 루프백 HTTPS 프록시의 외부 주소 (KOREAI_PUBLIC_URL)
                            (또는 KOREAI_MASTER_KEY_FILE)
  --dev                     Vite 개발 UI 허용
Linux 기본: Chromium. DISPLAY/WAYLAND_DISPLAY가 없으면 headless.
따릉이 HTTP 키 전송은 기본 차단. 운영자 허용: KOREAI_ALLOW_SEOUL_BIKE_HTTP=1
관리 화면은 127.0.0.1에 바인딩합니다. 원격 접속은 HTTPS 프록시 또는 SSH 포워딩을 사용하세요.`;
