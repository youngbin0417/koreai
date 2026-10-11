import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntime } from '../src/http.js';
import { admin } from '../src/core/engine.js';
import { connectionDefinitions } from '../src/connectors/lifestyle/index.js';
import type { BasicConnection } from '../src/connectors/lifestyle/types.js';
import type { Evidence, Job } from '../src/types.js';
import { TestVault, tempDir } from './helpers.js';

test('five basic connections enforce preparation, action scopes and fixed routes without inflating live coverage', async () => {
  const runtime = await createRuntime({ dataDir: tempDir('connections'), port: 0, vault: new TestVault(), fetcher: async () => { throw new Error('기본 연결은 공급자 API를 호출하지 않습니다.'); } });
  try {
    const bootstrap = await fetch(`${runtime.baseUrl}/api/bootstrap`, { method: 'POST', headers: { Origin: runtime.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: runtime.bootstrapCode }) });
    const cookie = bootstrap.headers.getSetCookie()[0].split(';')[0];
    const adminRequest = (path: string, method: string, body?: unknown) => fetch(`${runtime.baseUrl}/api${path}`, { method, headers: { Origin: runtime.baseUrl, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const definition of connectionDefinitions) {
      const ids = [`${definition.serviceId}.connection.status`, `${definition.serviceId}.connection.open`];
      const client = runtime.engine.createClient({ name: definition.name, allowedActions: ids });
      const agentRequest = (path: string, method = 'GET', body?: unknown) => fetch(`${runtime.baseUrl}/api${path}`, { method, headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const connections = await (await agentRequest('/connections')).json() as BasicConnection[];
      assert.equal(connections.length, 1); assert.equal(connections[0].serviceId, definition.serviceId); assert.equal(connections[0].state, 'unprepared');
      assert.equal((await agentRequest(`/connections/${definition.serviceId}`, 'PUT', { routeId: 'consumer' })).status, 403);
      assert.equal((await agentRequest(`/connections/${definition.serviceId}`, 'DELETE')).status, 403);
      assert.equal((await adminRequest(`/connections/${definition.serviceId}`, 'PUT', { routeId: 'https://evil.example' })).status, 409);
      assert.equal((await adminRequest(`/connections/${definition.serviceId}`, 'PUT', { routeId: 'consumer', apiKey: 'must-not-store' })).status, 400);
      const pending = await (await agentRequest('/jobs', 'POST', { actionId: ids[1], input: {}, idempotencyKey: randomUUID() })).json() as Job;
      await runtime.engine.idle(); assert.equal(runtime.engine.get(admin, pending.id).state, 'awaiting_user');
      assert.equal((await adminRequest(`/connections/${definition.serviceId}`, 'PUT', { routeId: 'consumer' })).status, 200);
      assert.equal((await agentRequest(`/jobs/${pending.id}/resume`, 'POST')).status, 200);
      await runtime.engine.idle();
      const completed = await (await agentRequest(`/jobs/${pending.id}`)).json() as Job;
      assert.equal(completed.state, 'succeeded'); assert.equal(completed.dispatched, false);
      const result = completed.result as { data: { url: string; requiresUser: boolean; externalActionExecuted: boolean; accountVerified: boolean } };
      assert.equal(result.data.url, definition.routes[0].url); assert.equal(result.data.requiresUser, true);
      assert.equal(result.data.externalActionExecuted, false); assert.equal(result.data.accountVerified, false);
      assert.equal((await agentRequest('/jobs', 'POST', { actionId: ids[1], input: { url: 'https://evil.example' }, idempotencyKey: randomUUID() })).status, 400);
      assert.equal((await agentRequest('/jobs', 'POST', { actionId: ids[0], input: {}, idempotencyKey: randomUUID() })).status, 202);
      await runtime.engine.idle(); assert.throws(() => runtime.engine.release(ids[0]), /실제 계정/);
      assert.equal((await adminRequest(`/connections/${definition.serviceId}`, 'DELETE')).status, 200);
      assert.equal((await (await agentRequest('/connections')).json() as BasicConnection[])[0].state, 'unprepared');
    }
    assert.equal(runtime.engine.metrics().verifiedServices, 0); assert.equal(runtime.engine.metrics().supportedActions, 0);
    assert(runtime.store.list<Evidence>('evidence').every(e => e.kind === 'mock'));
    assert(!JSON.stringify(runtime.store.list('connection-profile')).includes('must-not-store'));
  } finally { await runtime.close(); }
});

test('preparation survives restart; clearing it stops new entry jobs', async () => {
  const dataDir = tempDir('connection-persistence');
  let runtime = await createRuntime({ dataDir, port: 0, vault: new TestVault() });
  try {
    // Admin path is exercised over HTTP in the first test; seed the persisted public record here.
    runtime.store.put('connection-profile', 'coupang', { serviceId: 'coupang', routeId: 'seller', preparedAt: '2026-10-10', updatedAt: '2026-10-10' });
    await runtime.close();
    runtime = await createRuntime({ dataDir, port: 0, vault: new TestVault() });
    const job = runtime.engine.create(admin, { actionId: 'coupang.connection.open', input: {}, idempotencyKey: randomUUID() });
    await runtime.engine.idle();
    const result = runtime.engine.get(admin, job.id).result as { data: { url: string } };
    assert.equal(result.data.url, 'https://developers.coupang.com/ko');
    runtime.store.delete('connection-profile', 'coupang');
    const next = runtime.engine.create(admin, { actionId: 'coupang.connection.open', input: {}, idempotencyKey: randomUUID() });
    await runtime.engine.idle(); assert.equal(runtime.engine.get(admin, next.id).state, 'awaiting_user');
  } finally { await runtime.close(); }
});
