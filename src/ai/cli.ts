import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeepSeekCredentials, DEEPSEEK_BASE_URL } from './credentials.js';
import { DeepSeekClient } from './deepseek.js';
import { loadProjectEnv } from '../core/project-env.js';

async function stdin(secret = false): Promise<string> {
  if (secret && process.stdin.isTTY) {
    console.error('API 키를 입력하고 Enter를 누르세요. 입력은 표시되지 않습니다.');
    const previous = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    return new Promise((resolveInput, reject) => {
      let value = '';
      const finish = (error?: Error) => {
        process.stdin.off('data', collect); process.stdin.setRawMode(previous); process.stdin.pause();
        error ? reject(error) : resolveInput(value.trim());
      };
      const collect = (chunk: Buffer) => {
        for (const char of chunk.toString()) {
          if (char === '\r' || char === '\n' || char === '\u0004') { finish(); return; }
          if (char === '\u0003') { finish(new Error('키 등록을 취소했습니다.')); return; }
          if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
          else value += char;
          if (value.length > 100_000) { finish(new Error('입력 크기 제한을 초과했습니다.')); return; }
        }
      };
      process.stdin.on('data', collect); process.stdin.resume();
    });
  }
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk.toString();
    if (value.length > 100_000) throw new Error('입력 크기 제한을 초과했습니다.');
  }
  return value.trim();
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'data-dir': { type: 'string', default: '.koreai' }, smoke: { type: 'boolean', default: false }, effort: { type: 'string', default: 'high' } } });
  const command = positionals[0];
  const credentials = new DeepSeekCredentials(resolve(values['data-dir']!), undefined, loadProjectEnv());
  if (command === 'key') {
    await credentials.save(await stdin(true));
    console.log('DeepSeek API 키를 암호화해 저장했습니다. 모델: deepseek-flash (V4.1 Flash)');
    return;
  }
  if (!['check', 'ask'].includes(command)) throw new Error('사용법: ai:key (키를 stdin으로 전달), ai:check [--smoke], ai:ask "질문"');
  const client = new DeepSeekClient(await credentials.load());
  if (command === 'check') {
    const model = await client.verifyModel();
    console.log(JSON.stringify({ provider: 'deepseek', baseUrl: DEEPSEEK_BASE_URL, model, key: credentials.source, fallback: false }, null, 2));
    if (values.smoke) {
      const result = await client.respond('Reply with only OK.', 'low', 256);
      console.log(JSON.stringify({ smoke: 'passed', model: result.model, response: result.text, usage: result.usage }, null, 2));
    }
  } else {
    const effort = values.effort;
    if (!['low', 'high', 'max'].includes(effort!)) throw new Error('추론 강도는 low, high, max 중 하나여야 합니다.');
    const result = await client.respond(positionals.slice(1).join(' ') || await stdin(), effort as 'low' | 'high' | 'max');
    console.log(result.text);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'DeepSeek 설정을 확인하세요.'); process.exitCode = 1; });
}
