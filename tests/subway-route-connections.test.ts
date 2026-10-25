import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeSubwayRoute } from '../src/connectors/subway-route.js';
import { routeInput, routePayload } from './subway-route-fixture.js';
import { routeStationSelection } from '../ui/subway-route-connections-model.js';
import { applySubwayStation } from '../ui/subway-stations-model.js';
import { SubwayStationNotice } from '../ui/SubwayStations.js';
import { SubwayRouteResult } from '../ui/SubwayRoute.js';

function data() { const d = normalizeSubwayRoute(JSON.stringify(routePayload()), routeInput, new Date('2026-10-25T00:01:00Z')); d.segments[0]!.from.line = '2호선'; d.segments.at(-1)!.to.line = '1호선'; return d; }
test('route followups require an exact unique reference name and line and never reuse the provider code or infer aliases', () => {
  const d = data(), picked = routeStationSelection(d, 0, 'from')!; assert(picked); assert.equal(picked.station.name, '신도림'); assert.equal(picked.station.line, '2호선'); assert.notEqual(picked.station.stationId, d.segments[0]!.from.code);
  d.segments[0]!.from.code = '1001000133'; assert.equal(routeStationSelection(d, 0, 'from')!.station.stationId, picked.station.stationId);
  assert.equal(routeStationSelection(d, 2, 'to'), null); // 서울역 is not silently rewritten to the arrival reference 서울.
  d.segments[0]!.from.line = '02호선'; assert.equal(routeStationSelection(d, 0, 'from'), null);
  for (const value of [{}, { ...data(), retrievedAt: 'bad' }, { ...data(), searchAt: '<script>' }, { ...data(), status: 'no_data' }]) assert.equal(routeStationSelection(value, 0, 'from'), null);
  assert.equal(routeStationSelection(data(), -1, 'from'), null); assert.equal(routeStationSelection(data(), 900, 'to'), null);
});
test('route followups preserve target filters and time, while provenance stays visible only for the unchanged chosen station', () => {
  const d = data(), selected = routeStationSelection(d, 0, 'from')!, old = { stationName: '시청', lineName: '1호선', direction: '하행', day: '주말', temporary: 'Y', at: '2026-11-01T10:00:00+09:00', limit: 12 };
  const input = applySubwayStation('seoul-subway.timetable', JSON.stringify(old), selected.station.stationId); assert.deepEqual(JSON.parse(input), { ...old, stationName: '신도림', lineName: '2호선' });
  const source = { ...selected.source, jobId: 'route-test-job' }, html = renderToStaticMarkup(createElement(SubwayStationNotice, { target: 'seoul-subway.timetable', input, stationId: selected.station.stationId, routeSource: source })); assert(html.includes('경로 조회 시각')); assert(html.includes(source.retrievedAt)); assert(html.includes('코드 대응은 미검증')); assert(html.includes(source.jobId));
  assert.equal(renderToStaticMarkup(createElement(SubwayStationNotice, { target: 'seoul-subway.timetable', input: input.replace('신도림', '시청'), stationId: selected.station.stationId, routeSource: source })), '');
  const locker = JSON.parse(applySubwayStation('tlocker.inventory.search', '{"query":"시청","line":"1","size":"large","page":8,"limit":3}', selected.station.stationId)); assert.deepEqual(locker, { query: '신도림', line: '2', size: 'large', page: 1, limit: 3 });
});
test('route cards expose explicit draft controls for exact matches and explain unmapped names without guessing', () => {
  const html = renderToStaticMarkup(createElement(SubwayRouteResult, { result: { data: data() }, onUseStation: () => { throw Error('render must not dispatch'); } }));
  assert(html.includes('도착 조회 조건 채우기')); assert(html.includes('시간표 조건 채우기')); assert(html.includes('사물함 설치 조건 채우기')); assert(html.includes('별칭이나 코드를 자동 변환하지 않습니다')); assert(html.includes('조건만 채우며'));
});
