import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Snapshot only: API keys are not copied into child-process environments. Shell values take precedence. */
export function loadProjectEnv(base: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): NodeJS.ProcessEnv {
  const path = resolve(cwd, base.KOREAI_ENV_FILE || '.env');
  try {
    if (statSync(path).size > 1_000_000) throw Error('ENV_TOO_LARGE');
    const parsed = parseEnv(readFileSync(path, 'utf8'));
    const allowed = Object.fromEntries(Object.entries(parsed).filter(([key]) => key === 'DEEPSEEK_API_KEY' || key.startsWith('KOREAI_')));
    return { ...allowed, ...Object.fromEntries(Object.entries(base).filter(([, value]) => value !== undefined)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !base.KOREAI_ENV_FILE) return { ...base };
    throw new Error('환경변수 파일을 읽지 못했습니다. KOREAI_ENV_FILE 경로·파일 형식·크기를 확인하세요.');
  }
}
