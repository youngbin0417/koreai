import { findSubwayStation, stationLockerLines, subwayArrivalQueryName, subwayStations, type SubwayStation } from '../src/research/subway-stations';

export const stationTargets = ['seoul-subway.arrivals', 'seoul-subway.timetable', 'tlocker.inventory.search', 'seoul-subway.route'] as const;
export type StationTarget = typeof stationTargets[number];
export interface StationDraft { input: string; accountId: string; stationId?: string }
export function isStationTarget(value: string): value is StationTarget { return stationTargets.some(target => target === value); }
export function stationTargetAvailable(target: StationTarget, station: SubwayStation) {
  if (target === 'seoul-subway.route') return /^[1-8]호선$/.test(station.line);
  if (target === 'seoul-subway.timetable') return /^[1-8]호선$/.test(station.line);
  return target === 'seoul-subway.arrivals' || !!stationLockerLines[station.line];
}
export function searchSubwayStations(query: string, line = '', page = 1) {
  const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR'), text = fold(query.trim());
  const valid = text.length > 0 && text.length <= 80 && !/\p{C}/u.test(text);
  const matches = valid ? subwayStations.filter(station => (!line || station.line === line) && (fold(station.name).includes(text) || station.stationId.startsWith(text))) : [];
  const pages = Math.max(1, Math.ceil(matches.length / 10)), current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  return { rows: matches.slice((current - 1) * 10, current * 10), total: matches.length, page: current, pages };
}
function fields(target: StationTarget, station: SubwayStation, endpoint: 'origin' | 'destination' = 'origin'): Record<string, unknown> {
  if (!stationTargetAvailable(target, station)) throw Error('이 호선의 조건 연결은 아직 확인하지 않았습니다. 기존 조회 화면에서 직접 확인하세요.');
  if (target === 'seoul-subway.route') return { [endpoint]: station.name };
  if (target === 'tlocker.inventory.search') return { query: station.name, line: stationLockerLines[station.line], page: 1 };
  // getTrainSch accepts a station/line substring; this is a draft, never a verified cross-provider ID.
  const name = target === 'seoul-subway.timetable' && station.stationId === '1006000610' ? '응암' : subwayArrivalQueryName(station);
  return { stationName: name, ...(target === 'seoul-subway.timetable' ? { lineName: station.line } : {}) };
}
export function applySubwayStation(target: StationTarget, input: string, stationId: string, endpoint: 'origin' | 'destination' = 'origin') {
  const station = findSubwayStation(stationId); if (!station) throw Error('공식 참조 목록에서 역을 다시 선택하세요.');
  let value: unknown; try { value = JSON.parse(input); } catch { throw Error('기존 조회 조건의 JSON 입력을 수정한 뒤 역을 다시 적용하세요.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('기존 조회 조건 객체를 확인하세요.');
  return JSON.stringify({ ...value, ...fields(target, station, endpoint) }, null, 2);
}
export function stationDraftMatches(target: StationTarget, input: string, stationId?: string) {
  const station = stationId ? findSubwayStation(stationId) : undefined; if (!station || !stationTargetAvailable(target, station)) return false;
  try { const value = JSON.parse(input); if (target === 'seoul-subway.route') return value?.origin === station.name || value?.destination === station.name; return !!value && Object.entries(fields(target, station)).filter(([key]) => key !== 'page').every(([key, expected]) => value[key] === expected); } catch { return false; }
}
