import type { ConnectionDefinition } from './types.js';
import { tlockerGuideUrl,tlockerAndroidUrl,tlockerIosUrl,tlockerInventoryUrl } from '../../research/seoul-subway.js';
import { tlockerAvailabilityPlan } from './tlocker-read.js';
export const tlocker:ConnectionDefinition={serviceId:'tlocker',name:'또타라커',version:'0.1.0',domains:['www.smrte.co.kr','play.google.com','apps.apple.com','www.data.go.kr'],
  routes:[{id:'consumer',title:'공식 앱·이용 안내',kind:'handoff',url:tlockerGuideUrl,description:'운영사 안내에서 앱을 설치하고 역·크기·빈칸을 직접 확인합니다. KoreAI가 현황을 읽거나 문을 열지 않습니다.'},
    {id:'android',title:'Android 또타라커 설치',kind:'handoff',url:tlockerAndroidUrl,description:'운영사 공식 안내가 연결한 Google Play 앱입니다. 빈칸·예약·요금은 앱에서 직접 확인합니다.'},
    {id:'ios',title:'iPhone 또타라커 설치',kind:'handoff',url:tlockerIosUrl,description:'운영사 안내의 공식 App Store 앱 ID를 사용합니다. 빈칸·예약·요금은 앱에서 직접 확인합니다.'},
    {id:'inventory',title:'설치 수량 공공자료',kind:'handoff',url:tlockerInventoryUrl,description:'호선·역·크기별 설치 수량의 분기 자료입니다. 현재 빈칸 수·보관함 가용성을 뜻하지 않습니다.'}],
  boundary:'공식 앱 진입과 빈칸 조회 초안을 제공합니다. 공개 소비자 실시간 API는 미확인으로 자동 조회를 활성화하지 않습니다. 설치 수량을 빈칸으로 표시하지 않으며 예약·결제·문 열기는 별도 기능입니다.',firstRead:tlockerAvailabilityPlan,
  sources:[{title:'운영사 또타라커 안내·공식 앱 링크',url:tlockerGuideUrl,checkedAt:'2026-10-22'},{title:'서울교통공사 물품보관함 설치수량 · 분기 자료',url:tlockerInventoryUrl,checkedAt:'2026-10-22'}]};
