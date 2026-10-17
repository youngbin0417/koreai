export interface ConnectionPlan {
  requestedAt: string; aliases: string[];
  method: 'official-api' | 'public-data' | 'partnership';
  firstRead: string; requiredAccess: string; resultCheck: string; nextStep: string;
}
interface RequestedApp {
  serviceId: string; name: string; category: string; homeUrl: string; sourceUrl: string;
  priority: 2 | 3; documentedScope: string | null; plan: ConnectionPlan;
}
type Row = [id:string,name:string,url:string,firstRead:string,boundary:string,aliases?:string[]];
const groups: [string, Row[]][] = [
  ['쇼핑·중고', [
    ['musinsa','무신사','https://www.musinsa.com','공개 상품·옵션 후보 찾기','판매자 주문 API와 소비자 상품·주문 권한을 구분. 옵션·회원가·쿠폰 조건 확인.',['musinsa']],
    ['kream','KREAM','https://kream.co.kr','상품·사이즈별 표시 가격 확인','구매/판매 호가·체결가·수수료 구분. 비공식 앱 내부 API를 공식 경로로 사용하지 않음.',['크림','kream']],
    ['kyobo','교보문고','https://www.kyobobook.co.kr','도서·ISBN·매장 재고 후보 찾기','서지 검색과 지점별 재고·개인 구매내역을 분리.',['kyobo']],
    ['aladin','알라딘','https://www.aladin.co.kr','도서 검색·ISBN 상세 확인','TTB 키·등록 URL·이용약관·표시/캐시/LLM 전달 조건 확인. 개인 구매내역과 구분.',['aladin']],
    ['yes24-books','YES24 도서','https://www.yes24.com','도서·ISBN 후보 찾기','도서 상품과 YES24 티켓을 별도 서비스로 관리. 소비자 검색 제공 경로 확인.',['예스24','yes24']],
  ]],
  ['의료·예약', [
    ['catchtable','캐치테이블','https://www.catchtable.co.kr','식당·예약 가능 시간 후보 확인','고객 예약과 매장 파트너 권한을 구분. 예약금·취소 수수료·인원·시각 확인.',['catchtable']],
    ['tabling','테이블링','https://www.tabling.co.kr','매장·원격 대기 이용 안내 확인','공개 매장 정보와 개인 대기 순번을 분리. 대기 등록·취소는 후속 승인 작업.',['tabling']],
  ]],
  ['취업·채용', [
    ['jobkorea','잡코리아','https://www.jobkorea.co.kr','채용공고·마감일 후보 찾기','공개 공고와 비공개 이력서/지원내역·기업 채용 권한을 분리.',['jobkorea']],
    ['catch-jobs','캐치','https://www.catch.co.kr','공개 채용공고·기업 후보 찾기','채용 플랫폼 CATCH이며 캐치테이블과 다른 서비스. 입사 지원·이력서 전송은 별도.',['catch','채용캐치']],
    ['wanted','원티드','https://www.wanted.co.kr','직무·지역별 채용공고 후보 찾기','공개 채용공고와 이력서·지원·추천인 정보 권한을 구분.',['wanted']],
  ]],
  ['여행·지역생활', [
    ['myrealtrip','마이리얼트립','https://www.myrealtrip.com','여행 상품·일정별 후보 찾기','옵션·통화·세금·취소 조건과 개인 예약내역 권한을 분리.',['myrealtrip']],
    ['nol','NOL(야놀자)','https://nol.yanolja.com','숙박·여가 상품 후보 찾기','야놀자는 기존 NOL 항목으로 통합. 날짜·인원·객실별 가격과 예약내역을 구분.',['야놀자','yanolja','nol']],
    ['yeogi','여기어때','https://www.yeogi.com','숙소·객실 후보 찾기','투숙일·인원·객실·할인·취소 조건 확인. 예약 및 결제는 후속 단계.',['여기어때','yeogi']],
    ['33m2','삼삼엠투','https://33m2.co.kr','단기 임대 매물·기간별 후보 찾기','임대료·관리비·보증금·기간을 구분. 계약·송금·집주인 연락은 별도 승인.',['삼삼','33m2']],
  ]],
  ['배달·지역생활', [
    ['baemin','배달의민족','https://www.baemin.com','지정 지역의 가게·메뉴 후보 찾기','주소·시간대·배달비·최소주문 조건 확인. 사장님용 API를 소비자 주문 권한으로 사용하지 않음.',['배민','baemin']],
    ['coupang-eats','쿠팡이츠','https://www.coupangeats.com','지정 지역의 가게·메뉴 후보 찾기','소비자 배달 주문과 판매자/배달파트너 권한을 구분. 결제·주문은 후속 승인.',['coupangeats','coupang eats']],
    ['mega-coffee','메가MGC커피','https://www.mega-mgccoffee.com','매장·메뉴·픽업 이용 안내 찾기','메가오더의 지점·옵션·품절·쿠폰과 결제 실행을 분리.',['메가커피','메가오더','mega coffee']],
    ['mammoth-order','매머드오더','https://www.mmthcoffee.com/sub/order.html','매장·메뉴·픽업 이용 안내 찾기','앱 내 선불카드·스탬프·쿠폰·결제 권한은 별도. 모바일 앱 내부 API를 추정하지 않음.',['매머드커피','매머드 오더','mammoth']],
  ]],
  ['지도·교통', [
    ['seoul-bike','서울 따릉이','https://www.bikeseoul.com','대여소별 잔여 자전거 확인','요청 구간의 대여소 ID·잔여 수·조회 시각을 반환. 관측 시각은 미제공. HTTP 전송 운영자 설정 필요. 대여 보장·잠금 해제·결제는 별도.',['따릉이','seoul bike']],
    ['tmoney','티머니','https://www.tmoney.co.kr','교통카드·이용내역 확인 경로 안내','공개 이용 안내와 개인 카드 잔액·이용내역·충전 권한을 분리.',['티머니GO','tmoney']],
    ['tlocker','또타라커','https://www.seoulmetro.co.kr','역별 보관함 위치·이용 안내 찾기','보관함 위치와 실시간 빈칸·개인 예약을 구분. 문 열기·결제·예약은 별도 승인.',['또타락커','T-Locker','t locker']],
  ]],
  ['반려동물', [
    ['petplanet','펫플래닛','https://petplanet.co','지역·날짜별 돌봄 후보 찾기','돌봄 조건·가격·반려동물 정보·주소를 분리. 예약/돌봄 일지 접근은 사용자 동의 필요.',['petplanet']],
    ['mypetplus','마이펫플러스','https://www.mypetplus.co.kr','공개 동물병원·상담 안내 찾기','입점 병원·공개 상품과 실제 진료·예약 가능 여부를 구분.',['마이펫','mypetplus']],
    ['animal-hospitals','공공 동물병원 정보','https://www.data.go.kr/data/15045050/fileData.do','지역별 인허가 동물병원 찾기','영업상태·갱신일·좌표계를 확인. 인허가 상태를 현재 진료·야간 응급 가능으로 해석하지 않음.',['동물병원','동물병원 찾기']],
    ['animal-clinic-fees','동물병원 진료비 공개','https://animalclinicfee.or.kr','지역·항목별 공개 진료비 통계 확인','조사연도·지역·항목·통계 종류를 유지. 특정 병원의 견적·추천·진단으로 사용하지 않음.',['동물병원비','반려동물 진료비']],
  ]],
  ['검색·콘텐츠', [
    ['chzzk','치지직','https://chzzk.naver.com','라이브 목록·채널 정보 확인','공식 개발자 앱·필요 권한·한도를 확인. 채팅 발송·방송 설정 변경은 별도 승인.',['chzzk']],
    ['soop','SOOP','https://www.sooplive.com','공개 라이브·채널 후보 찾기','국내 SOOP과 다른 동명 서비스를 구분. 공식 API·확장 프로그램 범위를 확인하고 후원/채팅은 별도.',['숲','아프리카TV','soop']],
  ]],
  ['공공·세무', [
    ['hometax','홈택스','https://www.hometax.go.kr','세목·신고 기간별 공식 안내 찾기','공개 안내·개인 납부/환급 조회·신고 제출을 분리. 세무정보를 임의 확정하지 않음.',['손택스','국세']],
    ['wetax','위택스','https://www.wetax.go.kr','지방세 납부·신고 이용 안내 찾기','공개 일정/안내와 개인 고지·체납·납부·신고 권한을 분리.',['지방세','wetax']],
    ['samjjeomsam','삼쩜삼','https://www.3o3.co.kr','세금 환급 서비스·이용 조건 안내','조회·위임·수수료·신고 동의는 별도. 예상 환급과 확정 환급을 구분.',['삼점삼','3o3']],
  ]],
  ['공과금·통신', [
    ['gasapp','가스앱','https://www.gasapp.co.kr','지역·공급사별 요금 확인 경로 안내','지역 공급사·고객번호·사용월·고지월을 구분. 개인 청구액 조회는 본인 인증/제휴 필요.',['가스비','gasapp']],
    ['citygas','지역 도시가스 안내','https://www.citygas.or.kr','주소 지역의 도시가스 공급사 찾기','공급사 안내와 개인 요금 고지를 구분. 전국 공통 청구 API가 있다고 가정하지 않음.',['도시가스','가스요금']],
    ['tworld','SKT T world','https://www.tworld.co.kr','요금제·개인 청구 조회 경로 안내','공개 요금제와 본인 청구액·납부일·소액결제 정보를 분리. 인증과 수집 동의 필요.',['SKT','에스케이텔레콤','통신비']],
    ['my-kt','KT 마이케이티','https://my.kt.com','요금제·개인 청구 조회 경로 안내','회선·청구월·부가서비스·약정 정보를 분리. 개인 청구 API는 확인 대기.',['KT','마이케이티','통신비']],
    ['lguplus','LG U+','https://www.lguplus.com','요금제·개인 청구 조회 경로 안내','회선·결합·할인·청구 내역 권한을 분리. 요금제 변경·납부는 후속 승인.',['유플러스','LGU+','통신비']],
    ['smartchoice','스마트초이스','https://www.smartchoice.or.kr','공개 통신요금제·할인 안내 비교','공개 요금과 실제 본인 청구·미환급금 확인을 구분. 사업자·기준일·비교 조건을 유지.',['통신요금','알뜰폰','통신비']],
  ]],
];
const evidence: Record<string, {url:string;scope?:string;method?:ConnectionPlan['method']}> = {
  aladin: {url:'https://www.aladin.co.kr/ttb/wmain.aspx',scope:'공식 TTB OpenAPI의 상품 검색·상품 정보 및 가입/이용 안내.',method:'official-api'},
  chzzk: {url:'https://chzzk.gitbook.io/chzzk',scope:'공식 개발자 문서의 라이브 목록·채널 조회 및 권한별 API 안내.',method:'official-api'},
  'seoul-bike': {url:'https://data.seoul.go.kr/dataList/OA-15493/A/1/datasetView.do',method:'official-api'},
  'animal-hospitals': {url:'https://www.data.go.kr/data/15045050/fileData.do',scope:'공공 파일 데이터의 동물병원 인허가일·영업상태·사업장명·주소. 실시간 진료·예약 정보가 아님.',method:'public-data'},
  tlocker: {url:'https://mediahub.seoul.go.kr/archives/2013639'},
};
export const requestedApps: RequestedApp[] = groups.flatMap(([category,rows]) => rows.map(([serviceId,name,homeUrl,firstRead,boundary,aliases=[]]) => {
  const source = evidence[serviceId], method = source?.method ?? 'partnership';
  return {serviceId,name,category,homeUrl,sourceUrl:source?.url??homeUrl,priority:method==='partnership'?3:2,documentedScope:source?.scope??null,
    plan:{requestedAt:'2026-10-16',aliases,method,firstRead,requiredAccess:serviceId==='seoul-bike'?'서울 열린데이터광장 일반 인증키·행동 권한·운영자의 HTTP 키 전송 허용 설정':method==='official-api'?'사용자 소유 개발자 키·권한·이용 조건 확인':method==='public-data'?'공개 데이터의 이용 조건·파일 형식·갱신일 확인':'소비자용 공식 API/제휴·자동 접근 허용 확인. 확보 전 사용자 직접 진행',
      resultCheck:boundary,nextStep:serviceId==='seoul-bike'?'구간 조회 실행기 구현 완료. 본인 키·빈 구간·한도 검증과 공식 HTTPS 제공 여부 재확인.':method==='partnership'?'공식 제공 경로·권한·한도·보관/LLM 전달 조건 확인 후 첫 조회 규격 확정. 예약·결제·전송은 이후 별도 승인 단계.':'최신 요청/파일 규격·자료 기준일·한도·출처/캐시 조건을 검증한 뒤 조회 실행기 구현. 실제 키/계정 검증은 별도.'}};
}));
