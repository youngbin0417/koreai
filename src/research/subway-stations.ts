import { subwayStationRows } from './subway-station-data.js';
import { subwayArrivalDocs } from './seoul-subway.js';

export const subwayStationReference = {
  sourceUrl: subwayArrivalDocs, fileName: '실시간도착_역정보(20260902).xlsx', asOf: '2026-09-02', checkedAt: '2026-10-25',
  derivedSha256: "8e83bfa832a7b494ab653ed65847ba6a9ff9be1978689b00180ef81e51dcd038",
  byteLength: 29869, sha256: '537c1ab9f58b9b4d9bf35c34ac5d9de2e8b24bc25e3058d726f4a5bbae787da8', rows: 696,
  attribution: '출처: 서울특별시 TOPIS · 지하철 실시간 도착정보의 공식 역명 참조 파일',
  license: '공공누리 제1유형 · 출처표시',
} as const;
export interface SubwayStation { subwayId: string; stationId: string; name: string; line: string }
export const subwayStations: readonly SubwayStation[] = subwayStationRows.map(([subwayId, stationId, name, line]) => ({ subwayId, stationId, name, line }));
export const subwayStationLines = [...new Set(subwayStations.map(station => station.line))];
export function findSubwayStation(stationId: string) { return subwayStations.find(station => station.stationId === stationId); }
/** The provider page explicitly says to query 대모산 for 대모산입구. Keep the XLSX name intact. */
export function subwayArrivalQueryName(station: SubwayStation) { return station.stationId === '1075075220' ? '대모산' : station.name; }
/** Explicit file classifications, not conversions of provider station IDs. */
export const stationLockerLines: Readonly<Record<string, string>> = { '1호선': '1', '2호선': '2', '3호선': '3', '4호선': '4', '5호선': '5', '6호선': '6', '7호선': '7', '8호선': '8', '9호선': '9' };
