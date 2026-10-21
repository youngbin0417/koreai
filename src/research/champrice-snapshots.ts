export const champriceSourceUrl = 'https://www.data.go.kr/data/15083256/fileData.do';
const endpoint = 'https://www.data.go.kr/cmm/cmm/fileDownload.do';
// Add a month only after reviewing its history entry and downloading/validating the CSV.
export const champriceSnapshots = [
  { month: '2026-08', label: '2026년 8월', publishedOn: '2026-09-07', checkedAt: '2026-10-21',
    surveyDates: ['2026-08-07', '2026-08-28'], endpoint,
    query: { atchFileId: 'FILE_000000007654112', fileDetailSn: '1', insertDataPrcus: 'N' },
    sourceUrl: 'https://www.data.go.kr/tcs/dss/selectDpkDetailInfo.do?publicDataDetailPk=uddi%3Ad52c60ca-9b2f-4984-a6e0-a68a2cdd12d2&publicDataHistSn=1' },
  { month: '2026-09', label: '2026년 9월', publishedOn: '2026-10-02', checkedAt: '2026-10-21',
    surveyDates: ['2026-09-11', '2026-09-25'], endpoint,
    query: { atchFileId: 'FILE_000000007707356', fileDetailSn: '1', insertDataPrcus: 'N' }, sourceUrl: champriceSourceUrl },
] as const;
export type ChampriceMonth = typeof champriceSnapshots[number]['month'];
export const champriceDefaultMonth: ChampriceMonth = '2026-09';
export const champriceSnapshot = champriceSnapshots.find(s => s.month === champriceDefaultMonth)!;
export const champriceSnapshotFor = (month: ChampriceMonth) => champriceSnapshots.find(s => s.month === month)!;
