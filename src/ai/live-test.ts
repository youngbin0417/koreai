import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createRuntime } from '../http.js';
import { browserDefaults } from '../core/platform.js';
import { redact } from '../core/security.js';
import type { Job } from '../types.js';
import { DeepSeekCredentials, DEEPSEEK_MODEL } from './credentials.js';
import { DeepSeekClient } from './deepseek.js';
import { ProjectAgent } from './project-agent.js';
import { connectionDefinitions } from '../connectors/lifestyle/index.js';

const { values } = parseArgs({ options: {
  scenario: { type: 'string', default: 'owned-demo' }, url: { type: 'string', default: 'http://127.0.0.1:4318' },
  action: { type: 'string' }, 'account-id': { type: 'string' }, input: { type: 'string', default: '{}' },
  'data-dir': { type: 'string', default: '.koreai' }, help: { type: 'boolean' },
} });
const reportRoot = resolve('.test-data/deepseek-live');

async function main() {
  if (values.help) {
    console.log(`DeepSeek → KoreAI 실제 HTTP API 테스트 (API 사용량 발생)
npm run ai:test                         전용 시험 사이트 읽기·승인·게시·중복 방지
npm run ai:test -- --scenario connections  5개 기본 연결 상태·진입 안내 (외부 서비스 실행 아님)
npm run ai:test -- --scenario service-read --action ACTION --account-id UUID --input '{"query":"서울도서관"}'
실제 서비스 조회: 실행 중인 엔진의 KOREAI_TOKEN 환경변수, 허용 행동과 연결 계정 필요.
--url http://127.0.0.1:4318 --data-dir .koreai
Linux 브라우저 준비: npx playwright install --with-deps chromium`);
    return;
  }
  if (!['owned-demo', 'service-read', 'connections'].includes(values.scenario!)) throw new Error('scenario는 owned-demo, service-read 또는 connections여야 합니다.');
  const key = await new DeepSeekCredentials(resolve(values['data-dir']!)).load();
  const client = new DeepSeekClient(key);
  const model = await client.verifyModel();
  assert.equal(model.id, DEEPSEEK_MODEL);
  assert.equal(model.name, 'DeepSeek-V4.1-Flash', 'V4.1 Flash 계정 모델 이름 확인 실패');
  mkdirSync(reportRoot, { recursive: true, mode: 0o700 });
  const reportPath = join(reportRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`);
  const secrets = [key];
  let agent: ProjectAgent | undefined;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  const checks: Record<string, boolean> = {};
  let summaries: string[] = [];
  let failure: string | undefined;
  try {
    if (values.scenario === 'service-read') {
      const token = process.env.KOREAI_TOKEN;
      if (!token || !values.action) throw new Error('실제 서비스 조회에는 KOREAI_TOKEN과 --action이 필요합니다.');
      secrets.push(token);
      const input = JSON.parse(values.input!);
      assert(input && typeof input === 'object' && !Array.isArray(input), 'input은 JSON 객체여야 합니다.');
      agent = new ProjectAgent({ baseUrl: values.url!, token, allowedActions: [values.action], accountId: values['account-id'], readOnly: true,
        onStep: name => console.log(`도구 실행: ${name}`) });
      const actions = await agent.connect();
      assert(actions[0].enabled, actions[0].disabledReason ?? '연결 계정 또는 공급자 권한이 없습니다.');
      const answer = await agent.run(client, `먼저 기능을 검색하세요. ${values.action} 행동을 정확히 다음 입력으로 한 번 실행하고 작업 상태를 조회해 실제 결과를 보고하세요. 입력: ${JSON.stringify(input)}. 다른 행동이나 계정을 사용하지 마세요.`);
      summaries = [answer.text];
      const jobs = [...agent.jobs.values()];
      assert.equal(jobs.length, 1, '정확히 한 번 조회해야 합니다.');
      assert.deepEqual(jobs[0].input, input, '요청한 입력과 실제 실행 입력이 다릅니다.');
      assert.equal(jobs[0].state, 'succeeded', jobs[0].error?.message ?? '실제 조회 실패');
      checks.realServiceRead = true;
    } else {
      runtime = await createRuntime({ dataDir: mkdtempSync(join(reportRoot, 'runtime-')), port: 0,
        headless: true, channel: browserDefaults().channel, evidenceMode: 'mock' });
      secrets.push(runtime.bootstrapCode);
      const bootstrap = await fetch(`${runtime.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: runtime.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: runtime.bootstrapCode }) });
      assert(bootstrap.ok, '관리 세션 생성 실패');
      const cookie = bootstrap.headers.getSetCookie()[0]?.split(';')[0];
      assert(cookie, '관리 세션 쿠키가 없습니다.');
      secrets.push(cookie, cookie.split('=')[1]);
      const adminApi = async (path: string, method = 'GET', body?: unknown) => {
        const response = await fetch(`${runtime!.baseUrl}/api${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { Cookie: cookie, Origin: runtime!.baseUrl, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        assert(response.ok, `시험 관리자 API 실패: ${path} HTTP ${response.status}`);
        return await response.json();
      };
      const actions = values.scenario === 'connections' ? connectionDefinitions.flatMap(d => [`${d.serviceId}.connection.status`, `${d.serviceId}.connection.open`]) : ['browser.demo.read', 'browser.demo.publish'];
      const connected = await adminApi('/clients', 'POST', { name: 'DeepSeek 실제 API 시험', allowedActions: actions, allowedAccountIds: [] });
      const token = connected.token as string;
      assert(token, '시험 클라이언트 토큰 생성 실패'); secrets.push(token);
      if (values.scenario === 'connections') {
        for (const definition of connectionDefinitions) await adminApi(`/connections/${definition.serviceId}`, 'PUT', { routeId: 'consumer' });
        agent = new ProjectAgent({ baseUrl: runtime.baseUrl, token, allowedActions: actions, readOnly: true, maxJobs: 12, maxTurns: 10, onStep: name => console.log(`도구 실행: ${name}`) });
        await agent.connect();
        const answer = await agent.run(client, `먼저 koreai_find_actions를 query 빈 문자열로 한 번만 호출해 전체 행동을 검색하세요. 다음 5개 서비스 모두의 connection.status와 connection.open 행동을 각각 한 번 실행하세요: ${connectionDefinitions.map(d => d.serviceId).join(', ')}. 입력은 모두 {}입니다. 도구 호출은 한 응답당 최대 5개로 나눠 진행하세요. 만들어진 작업들의 상태를 도구로 조회하고 진입 URL을 간단히 보고하세요. 실제 로그인 또는 외부 작업 완료라고 표현하지 마세요. 이 테스트는 로컬 연결 준비와 사용자 진입 안내만 확인합니다.`);
        summaries.push(answer.text);
        assert.equal(agent.jobs.size, 10, '5개 서비스의 상태·진입 안내를 각각 한 번 확인해야 합니다.');
        for (const definition of connectionDefinitions) {
          const status: Job | undefined = [...agent.jobs.values()].find(j => j.actionId === `${definition.serviceId}.connection.status`);
          const open: Job | undefined = [...agent.jobs.values()].find(j => j.actionId === `${definition.serviceId}.connection.open`);
          assert.equal(status?.state, 'succeeded'); assert.equal(open?.state, 'succeeded');
          const prepared = status?.result as { data?: { state?: string; accountVerified?: boolean } };
          const entry = open?.result as { data?: { url?: string; externalActionExecuted?: boolean } };
          assert.equal(prepared.data?.state, 'prepared'); assert.equal(prepared.data?.accountVerified, false);
          assert.equal(entry.data?.url, definition.routes[0].url); assert.equal(entry.data?.externalActionExecuted, false);
          assert.equal(open?.dispatched, false); checks[`${definition.serviceId}BaseConnection`] = true;
        }
        assert.equal(runtime.engine.metrics().verifiedServices, 0); checks.linksExcludedFromServiceCoverage = true;
      } else {
      await adminApi('/browser/demo-login', 'POST');
      agent = new ProjectAgent({ baseUrl: runtime.baseUrl, token, allowedActions: actions, onStep: name => console.log(`도구 실행: ${name}`) });
      await agent.connect();
      const title = `DeepSeek API 시험 ${randomUUID().slice(0, 8)}`;
      const content = '실제 DeepSeek가 KoreAI HTTP API로 만든 시험 글입니다. 승인을 받은 뒤 게시합니다.';
      const first = await agent.run(client, `먼저 기능 검색을 수행하고 시험 사이트 게시글을 읽으세요. 그 후 제목 ${JSON.stringify(title)}, 내용 ${JSON.stringify(content)}인 글을 정확히 한 번 게시 요청하세요. 작업 상태를 조회하여 사용자 승인 대기인지 확인한 다음 멈추세요. 승인을 직접 수행하지 마세요.`);
      summaries.push(first.text);
      const writes = [...agent.jobs.values()].filter(j => j.effect === 'write');
      assert.equal(writes.length, 1, '게시 요청은 한 개여야 합니다.');
      const write = writes[0];
      assert.deepEqual(write.input, { title, content }, '시험 글 내용이 달라 승인할 수 없습니다.');
      assert.equal(write.state, 'pending_approval'); assert.equal(write.dispatched, false);
      assert.equal(runtime.store.list('demo-post').length, 0);
      assert([...agent.jobs.values()].some(j => j.effect === 'read' && j.state === 'succeeded'), '승인 전 실제 읽기 실패');
      checks.readBeforeApproval = true; checks.writeWaitsForApproval = true;
      const adminJob = await adminApi(`/jobs/${write.id}`);
      const blocked = await fetch(`${runtime.baseUrl}/api/jobs/${write.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: adminJob.revision, digest: adminJob.approvalDigest }) });
      assert.equal(blocked.status, 403);
      assert.equal((await agent.getJob(write.id)).state, 'pending_approval');
      assert.equal(runtime.store.list('demo-post').length, 0);
      checks.agentCannotApprove = true;
      console.log('승인 차단 확인. 시험 관리자에서 고정된 시험 글을 승인합니다.');
      await adminApi(`/jobs/${write.id}/approve`, 'POST', { revision: adminJob.revision, digest: adminJob.approvalDigest });
      const second = await agent.run(client, `시험 관리자가 방금 작업 ${write.id}을 승인했습니다. 이 작업의 상태와 결과를 조회하고, 시험 사이트 게시글을 새로 읽어서 제목 ${JSON.stringify(title)}과 내용 ${JSON.stringify(content)}이 실제로 나타나는지 확인하세요. 새 게시 요청은 만들지 마세요.`, first.messages);
      summaries.push(second.text);
      const completed = await agent.getJob(write.id);
      assert.equal(completed.state, 'succeeded', completed.error?.message ?? '승인 후 게시 실패');
      const receipt = completed.result as { data?: { jobId?: string; title?: string } };
      assert.equal(receipt.data?.jobId, write.id); assert.equal(receipt.data?.title, title);
      assert([...agent.jobs.values()].some(j => j.effect === 'read' && j.state === 'succeeded' && JSON.stringify(j.result).includes(title) && JSON.stringify(j.result).includes(content)), '새 페이지 조회에서 게시글 확인 실패');
      const replay = await fetch(`${runtime.baseUrl}/api/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: write.actionId, input: write.input, idempotencyKey: write.idempotencyKey }) });
      assert(replay.ok); assert.equal((await replay.json() as Job).id, write.id);
      const posts = runtime.store.list<{ id: string; title: string; content: string }>('demo-post');
      assert.equal(posts.length, 1); assert.deepEqual(posts[0], { id: write.id, title, content });
      checks.approvedWriteReceipt = true; checks.readAfterPublish = true; checks.duplicateDoesNotPublishAgain = true;
      assert.equal(runtime.engine.metrics().verifiedServices, 0);
      checks.fixtureExcludedFromServiceCoverage = true;
      }
    }
    assert(agent.trace.some(t => t.tool === 'koreai_find_actions'), '모델이 기능 검색을 호출하지 않았습니다.');
    assert(agent.trace.some(t => t.tool === 'koreai_get_job'), '모델이 작업 상태 조회를 호출하지 않았습니다.');
    assert(agent.responseModels.length > 0 && agent.responseModels.every(m => m === DEEPSEEK_MODEL), '다른 모델이 응답했습니다.');
    checks.modelUsesRealProjectTools = true; checks.onlyV41Flash = true;
  } catch (error) {
    failure = String(redact(error instanceof Error ? error.message : '테스트 실패', secrets));
    process.exitCode = 1;
  } finally {
    try { await runtime?.close(); } catch { failure ??= '시험 실행기 종료 실패'; process.exitCode = 1; }
    const report = { at: new Date().toISOString(), scenario: values.scenario, passed: !failure, platform: process.platform,
      llm: { verification: 'live', model, calls: agent?.usage.length ?? 0, usage: agent?.usage },
      serviceEvidence: values.scenario === 'service-read' ? 'live-service-read' : values.scenario === 'connections' ? 'local-preparation-and-entry-links; external Korean services not verified' : 'owned-fixture; external Korean services not verified',
      checks, summaries, jobs: [...(agent?.jobs.values() ?? [])], trace: agent?.trace ?? [], ...(failure ? { error: failure } : {}) };
    const safe = JSON.stringify(redact(report, secrets), null, 2);
    assert(secrets.every(s => !safe.includes(s)), '보고서 비밀정보 제거 실패');
    writeFileSync(reportPath, safe, { mode: 0o600 });
    console.log(`${failure ? 'FAIL' : 'PASS'}: ${values.scenario} / ${model.name} / 모델 호출 ${agent?.usage.length ?? 0}회`);
    console.log(`보고서: ${reportPath}`);
    if (failure) console.error(failure);
  }
}
main().catch(() => { console.error('AI 테스트를 시작하지 못했습니다. 암호화한 DeepSeek 키, 모델 권한, 테스트 옵션을 확인하세요.'); process.exitCode = 1; });
