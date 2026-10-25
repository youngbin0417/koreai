import assert from 'node:assert/strict';
export const routeSecret = 'subway-route-test-key+/=';
export const routeInput = { origin: '신도림', destination: '서울역', preference: 'transfer', at: '2026-10-25T09:00:00+09:00', includeTimetable: false };
// Synthetic values exercise explicit transfer edges; these are not real operating paths or station codes.
const station = (stnNm: string, lineNm: string, stnCd: string) => ({ stnNm, lineNm, stnCd, brlnNm: '시험 지선', stnNo: stnCd });
export function routePayload(input: Record<string, any> = routeInput) {
  const from = station(input.origin, '시험 2호선', 'test-001'), interchange = station('시험환승', '시험 2호선', 'test-002'), platform = station('시험환승', '시험 1호선', 'test-003'), to = station(input.destination, '시험 1호선', 'test-004');
  const segment = (dptreStn: typeof from, arvlStn: typeof from, trsitYn: string, stnSctnDstc: number) => ({ dptreStn, arvlStn, trsitYn, stnSctnDstc, reqHr: 90, trainDptreTm: '25:10:00', trainArvlTm: '25:11:30', wtngHr: 0, etrnYn: 'N', nonstopYn: 'N' });
  return { header: { resultCode: 0, resultMsg: '정상' }, body: { searchType: input.preference ?? 'duration', schInclYn: input.includeTimetable ? 'Y' : 'N', totalDstc: 2500, totalReqHr: 270, totalCardCrg: 1550, trsitNmtm: 1,
    paths: [segment(from, interchange, 'N', 1200), segment(interchange, platform, 'Y', 100), segment(platform, to, 'N', 1200)],
    trfstnNms: [{ stnNm: '시험환승', dptreLineNm: '시험 2호선', arvlLineNm: '시험 1호선' }] } };
}
export function routeMock() {
  const calls: URL[] = [], flags = { status: 200, body: null as unknown };
  const fetcher: typeof fetch = async (request, options) => {
    const url = new URL(String(request)); calls.push(url); assert.equal(url.origin, 'https://apis.data.go.kr'); assert.equal(url.pathname, '/B553766/path2/getShtrmPath2'); assert.equal(url.searchParams.get('serviceKey'), routeSecret);
    assert.equal(url.searchParams.get('stationValueType'), 'name'); assert.equal(url.searchParams.get('dataType'), 'JSON'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    const input = { origin: url.searchParams.get('dptreStn'), destination: url.searchParams.get('arvlStn'), preference: url.searchParams.get('searchType'), includeTimetable: url.searchParams.get('schInclYn') === 'Y' };
    return new Response(JSON.stringify(flags.body ?? routePayload(input)), { status: flags.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, flags, fetcher };
}
