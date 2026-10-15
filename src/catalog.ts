import type { Service } from './types.js';
import { expansionServices } from './research/app-api-backlog.js';

type Row = [string, string, string, string[]];
const groups: [string, Row[]][] = [
  ['소통·모임', [
    ['kakaotalk','카카오톡','https://www.kakaocorp.com/page/service/service/KakaoTalk',['나에게 보내기','친구에게 보내기','대화 확인']],
    ['band','밴드','https://band.us',['가입 모임 조회','글 읽기','글 작성']],
    ['naver-cafe','네이버 카페','https://cafe.naver.com',['가입','글 작성','글 조회']],
    ['daum-cafe','다음 카페','https://cafe.daum.net',['검색','글 조회','글 작성']],
    ['naver-mail','네이버 메일','https://mail.naver.com',['메일 조회','초안 작성','메일 전송']],
  ]],
  ['검색·콘텐츠', [
    ['naver-search','네이버 검색','https://www.naver.com',['뉴스 검색','블로그 검색','지역 검색']],
    ['daum-search','다음 검색','https://www.daum.net',['웹 검색','블로그 검색','카페 검색']],
    ['naver-blog','네이버 블로그','https://blog.naver.com',['글 검색','글 조회','글 작성']],
    ['tistory','티스토리','https://www.tistory.com',['글 조회','초안 작성','글 작성']],
    ['chzzk','치지직','https://chzzk.naver.com',['방송 검색','채널 조회','방송 알림']],
  ]],
  ['커뮤니티', [
    ['dcinside','디시인사이드','https://www.dcinside.com',['갤러리 찾기','글 조회','글 작성']],
    ['fmkorea','에펨코리아','https://www.fmkorea.com',['게시판 찾기','글 조회','글 작성']],
    ['clien','클리앙','https://www.clien.net',['글 검색','글 조회','글 작성']],
    ['theqoo','더쿠','https://theqoo.net',['게시판 찾기','글 조회','글 작성']],
    ['ppomppu','뽐뿌','https://www.ppomppu.co.kr',['상품 정보 찾기','글 조회','글 작성']],
  ]],
  ['쇼핑·중고', [
    ['naver-shopping','네이버 쇼핑','https://shopping.naver.com',['상품 검색','구매내역 조회','주문 취소']],
    ['coupang','쿠팡','https://www.coupang.com',['상품 검색','구매내역 조회','주문']],
    ['11st','11번가','https://www.11st.co.kr',['상품 검색','구매내역 조회','주문']],
    ['gmarket','G마켓','https://www.gmarket.co.kr',['상품 검색','구매내역 조회','주문']],
    ['daangn','당근','https://www.daangn.com',['동네 상품 찾기','채팅','판매글 작성']],
    ['kurly','마켓컬리','https://www.kurly.com',['상품 찾기','구매내역 조회','주문']],
  ]],
  ['배달·지역생활', [
    ['baemin','배달의민족','https://www.baemin.com',['가게 찾기','메뉴 확인','주문']],
    ['coupang-eats','쿠팡이츠','https://www.coupangeats.com',['가게 찾기','메뉴 확인','주문']],
    ['yogiyo','요기요','https://www.yogiyo.co.kr',['가게 찾기','메뉴 확인','주문']],
    ['daiso','다이소몰','https://www.daisomall.co.kr',['상품 찾기','매장 찾기','재고 확인']],
    ['oliveyoung','올리브영','https://www.oliveyoung.co.kr',['상품 찾기','매장 찾기','재고 확인']],
  ]],
  ['지도·교통', [
    ['naver-map','네이버 지도','https://map.naver.com',['장소 검색','경로 검색','길 안내']],
    ['kakao-map','카카오맵','https://map.kakao.com',['장소 검색','주소 검색','경로 검색']],
    ['tmap','TMAP','https://www.tmap.co.kr',['장소 검색','경로 검색','도착시간 조회']],
    ['korail','코레일톡','https://www.letskorail.com',['열차 조회','좌석 조회','예약']],
    ['srt','SRT','https://etk.srail.kr',['열차 조회','좌석 조회','예약']],
  ]],
  ['금융·인증', [
    ['toss','토스','https://toss.im',['로그인','금융 정보 조회','송금']],
    ['pass','PASS','https://www.passauth.co.kr',['인증 요청','인증 결과 조회','전자서명']],
    ['naver-pay','네이버페이','https://pay.naver.com',['결제 내역 조회','결제','송금']],
    ['kakao-pay','카카오페이','https://www.kakaopay.com',['결제 내역 조회','결제','송금']],
    ['kakao-bank','카카오뱅크','https://www.kakaobank.com',['계좌 조회','거래내역 조회','송금']],
  ]],
  ['공공·세무', [
    ['gov24','정부24','https://www.gov.kr',['민원 찾기','서류 발급','신청내역 조회']],
    ['subsidy24','보조금24','https://www.gov.kr/portal/rcvfvrSvc/main',['혜택 검색','혜택 상세','신청']],
    ['hometax','홈택스','https://www.hometax.go.kr',['세금 조회','신고 준비','증명서 발급']],
    ['nhis','국민건강보험','https://www.nhis.or.kr',['보험료 조회','자격 조회','증명서 발급']],
    ['nps','국민연금','https://www.nps.or.kr',['가입내역 조회','예상연금 조회','증명서 발급']],
  ]],
  ['의료·예약', [
    ['hira','건강보험심사평가원','https://www.hira.or.kr',['병원 검색','비급여 비용 조회','병원 평가 조회']],
    ['egen','응급의료포털 E-Gen','https://www.e-gen.or.kr',['응급실 찾기','병원 찾기','약국 찾기']],
    ['ddocdoc','똑닥','https://ddocdoc.com',['병원 찾기','접수','예약']],
    ['naver-booking','네이버 예약','https://booking.naver.com',['예약 상품 찾기','예약','예약내역 조회']],
    ['catchtable','캐치테이블','https://www.catchtable.co.kr',['식당 검색','예약','예약내역 조회']],
    ['gangnamunni','강남언니','https://unni.app',['병원 후보 찾기','시술 찾기','상담','예약']],
  ]],
  ['일정·문화·주거', [
    ['naver-calendar','네이버 캘린더','https://calendar.naver.com',['일정 추가','일정 조회','일정 수정']],
    ['cgv','CGV','https://www.cgv.co.kr',['영화 검색','상영시간 조회','예매']],
    ['megabox','메가박스','https://www.megabox.co.kr',['영화 검색','상영시간 조회','예매']],
    ['applyhome','청약홈','https://www.applyhome.co.kr',['청약 일정 조회','자격 확인','청약 신청']],
    ['naver-land','네이버 부동산','https://land.naver.com',['매물 검색','단지 정보','관심 매물 관리']],
  ]],
];
export const services: Service[] = groups.flatMap(([category,rows])=>rows.map(([id,name,homeUrl,candidateActions])=>({id,name,category,homeUrl,candidateActions,note:'조사 대상입니다. 아래 후보 행동은 구현·권한 확인 전이며 지원 기능 수에 포함되지 않습니다.'})));
const notes: Record<string,string> = {
  'dcinside':'자동 수집 제한이 명시되어 있습니다. 자동화 연결은 제휴·허용 범위 확인이 필요합니다.',
  'coupang':'공식 Open API는 판매자 업무용입니다. 소비자의 구매내역·주문 권한은 별도 확인 대상입니다.',
  'kurly':'기본 연결을 제공합니다. 컬리의 KLS OpenAPI는 물류용이며 소비자 쇼핑 기능은 별도 확인 대상입니다.',
  'gangnamunni':'공개 병원 후보 찾기의 입력·결과를 정의했습니다. 소비자 API·자동 접근 조건 확인 전이며 현재는 공식 병원 목록의 사용자 직접 확인 경로를 제공합니다.',
  'daangn':'기본 연결을 제공합니다. 당근비즈니스와 개인 중고거래·채팅 연동은 별도로 확인합니다.',
  'toss':'앱인토스 로그인·결제와 소비자의 금융 업무 연동은 별개입니다.',
  'pass':'인증·전자서명 API가 있습니다. 이용기관 계약과 사용자 본인 인증이 필요합니다.',
  'naver-calendar':'공식 API로 일정 추가를 구현합니다. 전체 일정 조회·수정은 별도 조사 대상입니다.',
  'kakaotalk':'첫 버전은 나에게 보내기만 구현합니다. 일반 대화방 읽기·임의 상대 발송을 지원하지 않습니다.',
};
for(const s of services) if(notes[s.id])s.note=notes[s.id]!;
services.push(...expansionServices(new Set(services.map(s=>s.id))));
