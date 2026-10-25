import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { subwayStationRows } from '../src/research/subway-station-data.js';
import { findSubwayStation, subwayArrivalQueryName, subwayStationReference as source, subwayStations, subwayStationLines } from '../src/research/subway-stations.js';
import { applySubwayStation, searchSubwayStations, stationDraftMatches, stationTargetAvailable } from '../ui/subway-stations-model.js';
import { SubwayStations, SubwayStationNotice } from '../ui/SubwayStations.js';

test('station reference preserves all 696 provider IDs, original names and line distinctions with a reviewed data fingerprint', () => {
  assert.equal(subwayStationRows.length, source.rows); assert.equal(new Set(subwayStations.map(row => row.stationId)).size, 696); assert.equal(subwayStationLines.length, 19);
  assert.equal(createHash('sha256').update(JSON.stringify(subwayStationRows)).digest('hex'), source.derivedSha256);
  for (const row of subwayStations) { assert.match(row.subwayId, /^\d{4}$/); assert.match(row.stationId, /^\d{10}$/); assert(!/\p{C}/u.test(row.name)); assert(row.line); }
  assert.equal(findSubwayStation('1001000133')!.name, '서울'); assert.equal(findSubwayStation('0150'), undefined); assert.equal(source.asOf, '2026-09-02');
  const daemosan = findSubwayStation('1075075220')!; assert.equal(daemosan.name, '대모산입구'); assert.equal(subwayArrivalQueryName(daemosan), '대모산');
});

test('local station search distinguishes homonyms and lines, never strips names or treats row order as transfer edges', () => {
  const sinchon = searchSubwayStations('신촌'); assert.equal(sinchon.total, 2); assert.deepEqual(new Set(sinchon.rows.map(row => row.line)), new Set(['2호선', '경의중앙선']));
  assert.equal(searchSubwayStations('신촌', '2호선').total, 1); assert.equal(searchSubwayStations('서울역', '1호선').total, 0); assert.equal(searchSubwayStations('1001000133').rows[0]!.name, '서울');
  assert.equal(searchSubwayStations('').total, 0); assert.equal(searchSubwayStations('a\nb').total, 0); assert.equal(searchSubwayStations('a'.repeat(81)).total, 0); assert.equal(searchSubwayStations('없는역').total, 0);
  const first = searchSubwayStations('1'), last = searchSubwayStations('1', '', 70); assert.equal(first.total, 696); assert.equal(first.rows.length, 10); assert.equal(last.rows.length, 6); assert.equal(searchSubwayStations('1', '', 999).page, 70);
});

test('station application changes search fields only, preserves original filters and never forwards reference IDs or hidden permissions', () => {
  const arrival = JSON.parse(applySubwayStation('seoul-subway.arrivals', '{"stationName":"시청","limit":7}', '1001000133')); assert.deepEqual(arrival, { stationName: '서울', limit: 7 });
  const old = { stationName: '시청', lineName: '2호선', direction: '하행', day: '주말', temporary: 'Y', at: '2026-10-25T09:00:00+09:00', limit: 12 };
  assert.deepEqual(JSON.parse(applySubwayStation('seoul-subway.timetable', JSON.stringify(old), '1001000133')), { ...old, stationName: '서울', lineName: '1호선' });
  const locker = { query: '시청', line: '2', size: 'large', page: 8, limit: 3 }; assert.deepEqual(JSON.parse(applySubwayStation('tlocker.inventory.search', JSON.stringify(locker), '1001000133')), { ...locker, query: '서울', line: '1', page: 1 });
  assert.equal(JSON.parse(applySubwayStation('tlocker.inventory.search', '{}', '1004000432')).query, '총신대입구(이수)');
  assert.equal(JSON.parse(applySubwayStation('seoul-subway.arrivals', '{}', '1075075220')).stationName, '대모산');
  assert.equal(JSON.parse(applySubwayStation('seoul-subway.timetable', '{}', '1006000610')).stationName, '응암');
  const gtx = findSubwayStation('1032000351')!; assert(stationTargetAvailable('seoul-subway.arrivals', gtx)); assert(!stationTargetAvailable('seoul-subway.timetable', gtx)); assert(!stationTargetAvailable('tlocker.inventory.search', gtx));
  for (const input of ['{broken', 'null', '[]', '"string"']) assert.throws(() => applySubwayStation('seoul-subway.arrivals', input, '1001000133'));
  assert.throws(() => applySubwayStation('seoul-subway.arrivals', '{}', '0150')); assert.throws(() => applySubwayStation('seoul-subway.timetable', '{}', gtx.stationId));
});

test('station provenance is shown only while the applied station and line remain unchanged', () => {
  const input = applySubwayStation('seoul-subway.timetable', '{"limit":5}', '1001000133'); assert(stationDraftMatches('seoul-subway.timetable', input, '1001000133'));
  assert(!stationDraftMatches('seoul-subway.timetable', input.replace('1호선', '2호선'), '1001000133')); assert(!stationDraftMatches('seoul-subway.timetable', input.replace('서울', '시청'), '1001000133')); assert(!stationDraftMatches('seoul-subway.arrivals', '{broken', '1001000133'));
  const html = renderToStaticMarkup(createElement(SubwayStationNotice, { target: 'seoul-subway.timetable', input, stationId: '1001000133' })); assert(html.includes('역 목록에서 적용')); assert(html.includes(source.asOf));
  assert.equal(renderToStaticMarkup(createElement(SubwayStationNotice, { target: 'seoul-subway.timetable', input: input.replace('서울', '시청'), stationId: '1001000133' })), '');
  const idle = renderToStaticMarkup(createElement(SubwayStations)); assert(idle.includes('696')); assert(idle.includes('제1유형')); assert(!idle.includes('<img')); assert(!idle.includes('역 선택 완료'));
});
