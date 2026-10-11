import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { scaffoldConnector } from '../src/connector-scaffold.js';
import { registerReviewedExtensions, type ReviewedExtension } from '../src/connectors/extensions.js';
import { officialActions } from '../src/connectors/official.js';
import type { Action } from '../src/types.js';
import { tempDir } from './helpers.js';

test('connector scaffold refuses traversal and overwrites; preview does not create files', () => {
  const projectRoot = tempDir('scaffold');
  const options = { id: 'hira-hospitals', serviceId: 'hira', name: '병원 검색', projectRoot };
  const preview = scaffoldConnector({ ...options, dryRun: true });
  assert.equal(preview.created, false);
  assert.equal(existsSync(join(projectRoot, 'src')), false);
  for (const id of ['../outside', '..', '/tmp/escape', 'a/b', 'a\\b', 'a.ts', 'Upper', 'a'.repeat(65)]) {
    assert.throws(() => scaffoldConnector({ ...options, id }), /경로는 사용할 수 없습니다/);
  }
  assert.throws(() => scaffoldConnector({ ...options, serviceId: '../hira' }), /경로는 사용할 수 없습니다/);
  assert.equal(existsSync(join(projectRoot, 'src')), false);
  const created = scaffoldConnector(options);
  assert.equal(created.path, join(projectRoot, 'src', 'connectors', 'custom', 'hira-hospitals.ts'));
  assert.equal(readFileSync(created.path, 'utf8'), preview.source);
  writeFileSync(created.path, '// existing work\n');
  assert.throws(() => scaffoldConnector(options), /덮어쓰지 않습니다/);
  assert.equal(readFileSync(created.path, 'utf8'), '// existing work\n');
});

test('generated disabled extension typechecks against current engine contracts', () => {
  const projectRoot = tempDir('scaffold-types');
  // Quotes/backslashes in names must stay data rather than becoming executable template text.
  const result = scaffoldConnector({ id: '11st-products', serviceId: '11st', name: '상품 "검색" \\ 테스트', projectRoot });
  for (const relative of ['src/types.ts', 'src/connectors/extensions.ts']) {
    const target = join(projectRoot, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(relative), target);
  }
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  const program = ts.createProgram([result.path], {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], esModuleInterop: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  assert.match(result.source, /implemented: false/);
  assert.match(result.source, /verification: 'unresearched'/);
  assert.match(result.source, /throw new ActionError\('NOT_IMPLEMENTED'/);
});

test('reviewed extension registration rejects all collisions before mutating the registry', () => {
  const actions = new Map<string, Action>([[officialActions[0]!.id, officialActions[0]!]]);
  const registered: string[] = [];
  const registry = { actions, register(additions: Action[]) { for (const action of additions) { actions.set(action.id, action); registered.push(action.id); } } };
  const executor: ReviewedExtension['executor'] = async () => ({ data: {}, evidence: 'mock' });
  const candidate = { ...officialActions[0]!, id: 'custom.example', implemented: false };
  assert.throws(() => registerReviewedExtensions(registry, [
    { actions: [candidate], executor }, { actions: [officialActions[0]!], executor },
  ]), /중복된 확장 행동 ID/);
  assert.deepEqual(registered, []);
  assert.throws(() => registerReviewedExtensions(registry, [{ actions: [candidate, candidate], executor }]), /중복된 확장 행동 ID/);
  registerReviewedExtensions(registry, [{ actions: [candidate], executor }]);
  assert.deepEqual(registered, ['custom.example']);
  assert.equal(actions.get('custom.example')?.implemented, false);
});
