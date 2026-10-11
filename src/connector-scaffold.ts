import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export interface ScaffoldOptions {
  id: string;
  serviceId: string;
  name: string;
  projectRoot?: string;
  dryRun?: boolean;
}

function identifier(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label}는 소문자·숫자·하이픈으로 된 1~64자여야 합니다. 경로는 사용할 수 없습니다.`);
  }
  return value;
}

/** Generates source only. Registration, account grants, and support verification are separate. */
export function scaffoldConnector(options: ScaffoldOptions) {
  const id = identifier(options.id, '커넥터 ID');
  const serviceId = identifier(options.serviceId, '서비스 ID');
  const name = options.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('이름은 제어 문자 없는 1~100자여야 합니다.');
  }
  const source = `import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../../types.js';
import type { ReviewedExtension } from '../extensions.js';

const schema = z.object({
  query: z.string().trim().min(1).max(200).describe('검색어: 실제 API 입력으로 교체하세요.'),
}).strict();

export const actions: Action[] = [{
  id: ${JSON.stringify(`${id}.example`)},
  connectorId: ${JSON.stringify(id)},
  serviceId: ${JSON.stringify(serviceId)},
  title: ${JSON.stringify(`${name} — 구현 준비`)},
  description: '공식 근거와 계정 권한을 확인한 후 구현할 후보 행동입니다.',
  category: '확장 준비',
  // 게시·전송·신청 등 외부 상태를 바꾸는 행동은 반드시 write로 선언하세요.
  effect: 'read',
  method: 'api',
  schema,
  inputSchema: zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>,
  // 필요한 경우 credentialType과 requiredSecrets를 지정하세요. 토큰을 입력 스키마로 받지 않습니다.
  requiredSecrets: [],
  scopes: [],
  sourceUrl: '',
  checkedAt: null,
  verification: 'unresearched',
  resultCheck: '공급자 응답에서 성공을 확인하는 필드·리소스 ID를 정의하세요.',
  domains: [],
  version: '0.1.0',
  maintainer: 'local',
  origin: 'user',
  implemented: false,
}];

export const execute: Executor = async (_action, _context) => {
  // 고정된 허용 URL만 사용하고 redirect: 'error', 취소 신호, 타임아웃을 적용하세요.
  // 외부 요청 직전에 context.dispatch()를 호출하고 성공 응답을 검증하세요.
  // 전송 후 결과가 불확실한 쓰기는 needs_review로 종료하고 자동 재전송하지 않습니다.
  throw new ActionError('NOT_IMPLEMENTED', '공식 근거·권한·실행 구현을 확인한 후 활성화하세요.');
};

export const extension: ReviewedExtension = { actions, executor: execute };
`;
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const directory = join(projectRoot, 'src', 'connectors', 'custom');
  const path = join(directory, `${id}.ts`);
  if (options.dryRun) return { path, source, created: false };

  // Refuse symlinked output directories instead of following them outside the chosen project.
  let current = projectRoot;
  if (!lstatSync(current).isDirectory()) throw new Error('프로젝트 경로가 디렉터리가 아닙니다.');
  for (const part of ['src', 'connectors', 'custom']) {
    current = join(current, part);
    try { mkdirSync(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('출력 경로에 연결 링크나 일반 파일을 사용할 수 없습니다.');
  }
  try { writeFileSync(path, source, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`기존 파일을 덮어쓰지 않습니다: ${path}`);
    throw error;
  }
  return { path, source, created: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      id: { type: 'string' }, 'service-id': { type: 'string' }, name: { type: 'string' },
      'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    } });
    if (values.help) {
      console.log('npm run connector:new -- --id hira-hospitals --service-id hira --name "병원 검색" [--dry-run]');
    } else {
      if (!values.id || !values['service-id'] || !values.name) throw new Error('--id, --service-id, --name이 필요합니다. --help로 사용법을 확인하세요.');
      const result = scaffoldConnector({ id: values.id, serviceId: values['service-id'], name: values.name, dryRun: values['dry-run'] });
      if (values['dry-run']) console.log(result.source);
      else {
        console.log(`커넥터 초안을 만들었습니다: ${result.path}`);
        console.log('구현·검토 후 src/connectors/extensions.ts에 명시적으로 등록하세요. docs/CONNECTORS.md를 확인하세요.');
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : '커넥터 초안을 만들지 못했습니다.');
    process.exitCode = 1;
  }
}
