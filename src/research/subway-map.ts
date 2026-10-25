import { subwayMapFilesUrl, subwayMapUrl } from './seoul-subway.js';

/** The dated original is a separate KOGL asset, not Apache-2.0 project artwork. */
export const subwayMapSnapshot = {
  title: '서울교통공사 수도권 지하철 노선도 · 국문',
  declaredAsOf: '2025-12-08', publishedOn: '2025-12-08', pageModifiedOn: '2026-09-10', checkedAt: '2026-10-25',
  sourceUrl: subwayMapFilesUrl, currentMapUrl: subwayMapUrl,
  originalUrl: 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003557016&fileDetailSn=1&insertDataPrcus=N',
  archiveSha256: 'fa08ddebcee0e20eda23e78600c572c29ba4c84239aa96be694bbcaaf51075f2',
  archiveMember: '25년 노선도리뉴얼 국문(25.12.).jpg',
  assetUrl: '/maps/seoul-metro-ko-20251208.jpg',
  byteLength: 10509901, width: 6142, height: 6142,
  sha256: '8c8dbb0451384a3b703a1709bafc220ca4bc7e4959868ba5bf0f6af6f3151914',
  license: '공공누리 제3유형 · 출처표시·변경금지',
  attribution: '출처: 서울교통공사, 수도권 지하철 노선도 4종(국영중일)_20251208 중 국문 원본',
} as const;
