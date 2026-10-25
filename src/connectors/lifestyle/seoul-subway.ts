import type { ConnectionDefinition } from './types.js';
import { subwayMapUrl,subwayMapFilesUrl,subwayArrivalDocs,subwayTimetableDocs,subwayRouteDocs } from '../../research/seoul-subway.js';
export const seoulSubway:ConnectionDefinition={serviceId:'seoul-subway',name:'서울·수도권 지하철',version:'0.1.0',domains:['www.seoulmetro.co.kr','data.seoul.go.kr','www.data.go.kr'],
  routes:[{id:'consumer',title:'서울교통공사 공식 노선도',kind:'handoff',url:subwayMapUrl,description:'공식 사이버스테이션에서 노선도·역·이동 경로를 직접 확인합니다. KoreAI의 보관 원본 뷰어는 별도 노선도 화면에서 제공하며 경로는 공식 화면에서 직접 확인합니다.'},
    {id:'map-files',title:'공식 노선도 파일 · 4개 언어',kind:'handoff',url:subwayMapFilesUrl,description:'공공데이터포털에서 서울교통공사의 원본 노선도를 확인합니다. 자료 시점을 확인하고 변경 없이 이용하세요.'},
    {id:'arrivals',title:'도착정보 API 신청·명세',kind:'handoff',url:subwayArrivalDocs,description:'서울시 제공 도착정보의 인증키·역 이름·범위를 확인합니다. 서울시 외 일부 역 구간은 미제공입니다.'},
    {id:'timetable',title:'시간표 API 신청·명세',kind:'handoff',url:subwayTimetableDocs,description:'예정 시간표의 요일·방향·유효기간·실제 계정 승인 범위를 확인합니다.'}],
  boundary:'보관 원본은 노선도 화면에서 확대·이동하며 보고, 최신 공식 노선도는 사용자가 직접 엽니다. 별도 API 행동으로 실시간 도착·예정 시간표·공식 경로/환승을 조회하며 서로 다른 계정·시각·제공 범위를 구분합니다. 경로는 별도 공공데이터포털 키와 HTTPS를 사용합니다. 노선도 링크를 API 조회나 경로 계산의 지원 실적으로 집계하지 않습니다.',
  sources:[{title:'서울교통공사 공식 노선도 원본·사이버스테이션 안내',url:subwayMapFilesUrl,checkedAt:'2026-10-25'},{title:'서울시 지하철 실시간 도착정보',url:subwayArrivalDocs,checkedAt:'2026-10-22'},{title:'서울교통공사 현행 열차시간표',url:subwayTimetableDocs,checkedAt:'2026-10-22'},{title:'서울교통공사 최단경로이동정보·별도 키',url:subwayRouteDocs,checkedAt:'2026-10-25'}]};
