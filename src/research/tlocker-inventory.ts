export const tlockerInventorySourceUrl = 'https://www.data.go.kr/data/15044235/fileData.do';
export const tlockerInventorySnapshot = {
  asOf: '2026-09-30', publishedOn: '2026-10-06', checkedAt: '2026-10-25',
  endpoint: 'https://www.data.go.kr/cmm/cmm/fileDownload.do',
  query: { atchFileId: 'FILE_000000007708756', fileDetailSn: '1', insertDataPrcus: 'N' },
  reviewedSha256: 'f8f95844cfd1ea0d75e7ceda5f54be80065525b62657d743c0bda9a975c57405',
  reviewedByteLength: 8321, reviewedRows: 341,
} as const;
export const tlockerInventoryLines = ['1','2','3','4','5','6','7','8','9','식물원'] as const;
export const tlockerInventorySizes = [{value:'any',label:'모든 설치 크기'},{value:'small',label:'소형 설치 있음'},{value:'medium',label:'중형 설치 있음'},{value:'large',label:'대형 설치 있음'}] as const;
