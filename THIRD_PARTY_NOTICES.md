# 외부 저작물 고지

## 서울교통공사 국문 노선도

- 저작자·출처: **서울교통공사**, 「수도권 지하철 노선도 4종(국영중일)_20251208」 중 국문 원본.
- 공식 자료: https://www.data.go.kr/data/15120713/fileData.do
- 이용 조건: **공공누리 제3유형 — 출처표시·변경금지**. 출처 페이지에서 2026-10-25 확인했습니다. 이 JPG에는 프로젝트 코드의 Apache-2.0 라이선스를 적용하지 않습니다.
- 제품 파일: `public/maps/seoul-metro-ko-20251208.jpg` (10,509,901바이트, 6142×6142).
- 원본 ZIP: https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003557016&fileDetailSn=1&insertDataPrcus=N
- ZIP 내 원본명: `25년 노선도리뉴얼 국문(25.12.).jpg`.
- JPG SHA-256: `8c8dbb0451384a3b703a1709bafc220ca4bc7e4959868ba5bf0f6af6f3151914`.
- ZIP SHA-256: `fa08ddebcee0e20eda23e78600c572c29ba4c84239aa96be694bbcaaf51075f2`.

ZIP에서 추출한 JPG의 바이트를 그대로 배포합니다. 재인코딩·잘라내기·색상 변경·노선/역 표시 추가를 하지 않았습니다. 확대·이동은 브라우저의 표시 크기와 스크롤만 조절합니다. 화면과 배포 파일을 재사용할 때도 이 고지와 출처·이용 조건을 유지하세요. 본 서비스에 대한 서울교통공사의 후원·공식 인증을 의미하지 않습니다.

자료명의 날짜는 2025-12-08, 출처 페이지 수정일은 2026-09-10입니다. 페이지 수정일을 노선도의 기준일로 사용하지 않습니다. 최신 운행·개통 변경은 https://www.seoulmetro.co.kr/kr/cyberStation.do 에서 확인합니다.


## 서울특별시 도착정보 역명 참조 데이터

- 저작자·출처: **서울특별시 TOPIS**, 서울시 지하철 실시간 도착정보(OA-12764)의 `실시간도착_역정보(20260902).xlsx`.
- 공식 출처: https://data.seoul.go.kr/dataList/OA-12764/A/1/datasetView.do
- 이용 조건: **공공누리 제1유형 — 출처표시** (2026-10-25 확인). 이 데이터의 이용 조건은 엔진 코드의 Apache-2.0과 구분합니다.
- 제품 파일: `src/research/subway-station-data.ts`. 원본의 `SUBWAY_ID/STATN_ID/STATN_NM/호선이름` 696행을 문자열 튜플로 추출했습니다. 자료의 순서는 경로·인접·환승 정보를 의미하지 않습니다.
- 원본 다운로드: 공식 출처의 해당 파일 다운로드 버튼 (POST `https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false`, `infId=OA-12764, infSeq=2, seq=57, seqNo=`).
- 원본 XLSX 29,869바이트, SHA-256 `537c1ab9f58b9b4d9bf35c34ac5d9de2e8b24bc25e3058d726f4a5bbae787da8`.
- 배포 튜플의 JSON SHA-256 `8e83bfa832a7b494ab653ed65847ba6a9ff9be1978689b00180ef81e51dcd038`. 원본 ID·이름을 보존하며 검색용 예외 이름은 별도 코드에 명시합니다.

화면에 출처·파일명·기준일·이용 조건을 표시합니다. 실제 운행·개통·API 계정 검증을 보증하지 않으며 서울특별시의 후원·공식 인증을 의미하지 않습니다.
