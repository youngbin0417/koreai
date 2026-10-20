import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import iconv from 'iconv-lite';
import { ActionError, assertActionAvailable, type Action, type Executor, type ExecutionContext } from '../types.js';
import { naverSearchAvailability } from './naver-availability.js';
import { redact } from '../core/security.js';

const text = (description: string, max = 1000) => z.string().trim().min(1).max(max).describe(description);
const id = (description: string) => text(description, 160).regex(/^[a-zA-Z0-9_-]+$/);
const num = (description: string, max = 100) => z.number().int().min(1).max(max).describe(description);
const checkedAt = '2026-09-29';
const jsonSchema = (schema: z.ZodTypeAny) => zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
const urls = {
  naver: 'https://developers.naver.com/docs/serviceapi/search/blog/blog.md',
  cafe: 'https://developers.naver.com/docs/login/cafe-api/cafe-api.md',
  calendar: 'https://developers.naver.com/docs/login/calendar-api/calendar-api.md',
  band: 'https://developers.band.us/develop/guide/api',
  kakao: 'https://developers.kakao.com/docs/ko/kakaotalk-message/rest-api',
  map: 'https://developers.kakao.com/docs/ko/local/dev-guide',
  daum: 'https://developers.kakao.com/docs/ko/daum-search/dev-guide',
  gov: 'https://www.data.go.kr/data/15113968/openapi.do',
};
function define(args: { id: string; serviceId: string; connectorId: string; title: string; description: string; category: string; schema: z.ZodTypeAny; credentialType: string; requiredSecrets: string[]; sourceUrl: string; domains: string[]; scopes?: string[]; effect?: 'read' | 'write'; resultCheck?: string }): Action {
  return { ...args, inputSchema: jsonSchema(args.schema), effect: args.effect ?? 'read', method: 'api', scopes: args.scopes ?? [], checkedAt, verification: 'documented', resultCheck: args.resultCheck ?? '공급자 정상 응답과 결과 필드 확인', version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true, unavailable: naverSearchAvailability(args.id) };
}
export const officialActions: Action[] = [
  ...(['news', 'blog', 'cafearticle', 'shop', 'local'] as const).map((kind, i) => define({
    id: `naver.search.${kind}`, serviceId: 'naver-search', connectorId: 'naver-search', title: `네이버 ${['뉴스','블로그','카페글','쇼핑','지역'][i]} 검색`, category: '검색',
    description: '공식 검색 결과의 제목·요약·링크를 조회합니다. 비공개 글이나 원문 전체를 수집하지 않습니다.',
    schema: z.object({ query: text('검색어'), display: num('결과 수', kind === 'local' ? 5 : 100).default(kind === 'local' ? 5 : 10), start: num('시작 위치', kind === 'local' ? 1 : 1000).default(1) }).strict(),
    credentialType: 'naver-app', requiredSecrets: ['clientId','clientSecret'], sourceUrl: urls.naver, domains: ['openapi.naver.com'],
  })),
  define({ id: 'naver.cafe.join', serviceId: 'naver-cafe', connectorId: 'naver-cafe', title: '네이버 카페 가입 요청', category: '모임', effect: 'write', description: '공개·가입 가능한 카페에 가입 요청을 보냅니다.',
    schema: z.object({ clubId: text('숫자 카페 ID').regex(/^\d+$/), nickname: text('가입 별명', 40) }).strict(), credentialType: 'naver-user', requiredSecrets: ['accessToken'], scopes: ['cafe'], sourceUrl: urls.cafe, domains: ['openapi.naver.com'], resultCheck: 'message.status 및 가입 처리 응답 확인' }),
  define({ id: 'naver.cafe.publish', serviceId: 'naver-cafe', connectorId: 'naver-cafe', title: '네이버 카페 글 작성', category: '게시', effect: 'write', description: '가입한 카페의 지정 게시판에 글을 작성합니다. 상품 게시판·이미지 첨부는 이 버전에서 제공하지 않습니다.',
    schema: z.object({ clubId: text('숫자 카페 ID').regex(/^\d+$/), menuId: text('숫자 게시판 ID').regex(/^\d+$/), subject: text('제목', 200), content: text('본문 HTML', 20_000), public: z.boolean().default(false) }).strict(), credentialType: 'naver-user', requiredSecrets: ['accessToken'], scopes: ['cafe'], sourceUrl: urls.cafe, domains: ['openapi.naver.com'], resultCheck: 'message.status와 articleId·articleUrl 확인' }),
  define({ id: 'naver.calendar.create', serviceId: 'naver-calendar', connectorId: 'naver-calendar', title: '네이버 일정 추가', category: '일정', effect: 'write', description: '기본 캘린더에 단일 일정을 추가합니다. 날짜에는 +09:00 등 시간대를 포함하세요.',
    schema: z.object({ title: text('일정 제목', 200), start: z.string().datetime({ offset: true }).describe('시작 ISO 8601, 예: 2026-10-01T10:00:00+09:00'), end: z.string().datetime({ offset: true }).describe('종료 ISO 8601'), location: z.string().max(1000).default(''), description: z.string().max(5000).default('') }).strict().refine(v => Date.parse(v.end) > Date.parse(v.start), '종료는 시작 이후여야 합니다.'), credentialType: 'naver-user', requiredSecrets: ['accessToken'], scopes: ['calendar'], sourceUrl: urls.calendar, domains: ['openapi.naver.com'], resultCheck: 'result=success 및 반환된 일정 UID 대조' }),
  ...(['bands', 'posts', 'post', 'publish'] as const).map((kind, i) => define({
    id: `band.${kind}`, serviceId: 'band', connectorId: 'band', title: ['가입 밴드 목록','밴드 게시글 목록','밴드 게시글 상세','밴드 글 작성'][i]!, category: kind === 'publish' ? '게시' : '모임', effect: kind === 'publish' ? 'write' : 'read',
    description: kind === 'publish' ? '선택한 밴드에 글을 게시합니다.' : '사용자가 접근할 수 있는 밴드 정보를 조회합니다.',
    schema: kind === 'bands' ? z.object({}).strict() : kind === 'posts' ? z.object({ bandKey: id('밴드 키'), after: z.string().max(500).optional() }).strict() : kind === 'post' ? z.object({ bandKey: id('밴드 키'), postKey: id('게시글 키') }).strict() : z.object({ bandKey: id('밴드 키'), content: text('게시글 본문', 10_000), doPush: z.boolean().default(false) }).strict(),
    credentialType: 'band-user', requiredSecrets: ['accessToken'], sourceUrl: urls.band, domains: ['openapi.band.us'], resultCheck: kind === 'publish' ? 'result_code=1 및 post_key 확인' : 'result_code=1 및 result_data 확인',
  })),
  define({ id: 'kakao.message.self', serviceId: 'kakaotalk', connectorId: 'kakao-message', title: '카카오톡 나에게 보내기', category: '메시지', effect: 'write', description: '현재 연결한 계정의 나와의 채팅에 텍스트 템플릿 메시지를 보냅니다. 링크는 카카오 앱에 등록된 도메인을 사용하세요.',
    schema: z.object({ text: text('메시지', 200), link: z.string().url().refine(v => /^https?:/.test(v), 'HTTP(S) 링크를 입력하세요.').describe('앱에 등록한 웹 링크'), buttonTitle: text('버튼 제목', 10).default('자세히 보기') }).strict(), credentialType: 'kakao-user', requiredSecrets: ['accessToken'], scopes: ['talk_message'], sourceUrl: urls.kakao, domains: ['kapi.kakao.com'], resultCheck: 'result_code=0 확인' }),
  ...(['places','address'] as const).map((kind, i) => define({ id: `kakao.map.${kind}`, serviceId: 'kakao-map', connectorId: 'kakao-map', title: ['카카오 장소 검색','카카오 주소 검색'][i]!, category: '지도', description: '주소·장소명과 좌표를 공식 API에서 조회합니다.',
    schema: z.object({ query: text('검색어'), page: num('페이지',45).default(1), size: num('결과 수', kind === 'places' ? 15 : 30).default(10) }).strict(), credentialType: 'kakao-app', requiredSecrets: ['restApiKey'], sourceUrl: urls.map, domains: ['dapi.kakao.com'] })),
  ...(['web','blog','cafe'] as const).map((kind, i) => define({ id: `daum.search.${kind}`, serviceId: 'daum-search', connectorId: 'daum-search', title: `다음 ${['웹','블로그','카페'][i]} 검색`, category: '검색', description: '다음의 공개 검색 결과를 조회합니다.',
    schema: z.object({ query: text('검색어'), page: num('페이지',50).default(1), size: num('결과 수',50).default(10) }).strict(), credentialType: 'kakao-app', requiredSecrets: ['restApiKey'], sourceUrl: urls.daum, domains: ['dapi.kakao.com'] })),
  ...(['list','detail'] as const).map((kind, i) => define({ id: `gov.benefits.${kind}`, serviceId: 'subsidy24', connectorId: 'gov-benefits', title: ['공공혜택 목록 검색','공공혜택 상세 조회'][i]!, category: '공공', description: '공공서비스 정보를 조회합니다. 개인 수급 자격 판정이나 신청을 수행하지 않습니다.',
    schema: kind === 'list' ? z.object({ query: z.string().max(200).default(''), page: num('페이지',10000).default(1), perPage: num('결과 수',100).default(10) }).strict() : z.object({ serviceId: text('서비스 ID',100) }).strict(), credentialType: 'data-go-kr', requiredSecrets: ['serviceKey'], sourceUrl: urls.gov, domains: ['api.odcloud.kr'] })),
];

export interface ApiRequest { url: URL; init: RequestInit }
const q = (base: string, params: Record<string, unknown>): URL => {
  const url = new URL(base); for (const [k,v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v)); return url;
};
function icalEscape(v: string): string { return v.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
export function calendarBody(input: Record<string, unknown>, uid: string): string {
  const utc = (v: unknown) => new Date(String(v)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//KoreAI//Calendar//KO','BEGIN:VEVENT',`UID:${uid}@koreai.local`,`DTSTAMP:${utc(new Date().toISOString())}`,`DTSTART:${utc(input.start)}`,`DTEND:${utc(input.end)}`,`SUMMARY:${icalEscape(String(input.title))}`,`LOCATION:${icalEscape(String(input.location))}`,`DESCRIPTION:${icalEscape(String(input.description))}`,'END:VEVENT','END:VCALENDAR'];
  // Fold at UTF-8 byte boundaries, RFC 5545 (continuation includes one space).
  return lines.map(line => { let out='', size=0; for (const ch of line) { const n=Buffer.byteLength(ch); if (size+n>74) { out+='\r\n ';size=1; } out+=ch;size+=n; } return out; }).join('\r\n')+'\r\n';
}
function cafeForm(values: Record<string, unknown>): string {
  // NAVER specifies UTF-8 URL encoding followed by MS949 URL encoding for text fields.
  return Object.entries(values).map(([k,v]) => `${k}=${Array.from(iconv.encode(['nickname','subject','content'].includes(k)?encodeURIComponent(String(v)):String(v), 'cp949')).map(b => `%${b.toString(16).toUpperCase().padStart(2,'0')}`).join('')}`).join('&');
}
export function buildRequest(action: Action, context: ExecutionContext): ApiRequest {
  const { input }=context.job, s=context.secrets, a=action.id;
  const init: RequestInit={ method:'GET', redirect:'error', signal:context.signal, headers:{ Accept:'application/json' } };
  let url: URL;
  const form=(values: Record<string,unknown>) => { init.method='POST'; init.body=new URLSearchParams(Object.entries(values).map(([k,v])=>[k,String(v)])); };
  if (a.startsWith('naver.search.')) {
    url=q(`https://openapi.naver.com/v1/search/${a.split('.').at(-1)}.json`, input);
    init.headers={...init.headers,'X-Naver-Client-Id':s.clientId!, 'X-Naver-Client-Secret':s.clientSecret!};
  } else if (a.startsWith('naver.cafe.')) {
    url=new URL(`https://openapi.naver.com/v1/cafe/${input.clubId}/${a.endsWith('join')?'members':`menu/${input.menuId}/articles`}`);
    init.headers={...init.headers,Authorization:`Bearer ${s.accessToken}`,'Content-Type':'application/x-www-form-urlencoded'};
    init.method='POST'; init.body=cafeForm(a.endsWith('join')?{nickname:input.nickname}:{subject:input.subject,content:input.content,openyn:input.public,searchopen:input.public});
  } else if (a==='naver.calendar.create') {
    url=new URL('https://openapi.naver.com/calendar/createSchedule.json'); init.headers={...init.headers,Authorization:`Bearer ${s.accessToken}`};
    form({calendarId:'defaultCalendarId',scheduleIcalString:calendarBody(input,context.job.id)});
  } else if (a.startsWith('band.')) {
    const kind=a.split('.')[1]; const params={access_token:s.accessToken,locale:'ko_KR',...(input.bandKey?{band_key:input.bandKey}:{}),...(input.postKey?{post_key:input.postKey}:{}),...(input.after?{after:input.after}:{})};
    if(kind==='publish'){url=new URL('https://openapi.band.us/v2.2/band/post/create');form({access_token:s.accessToken,band_key:input.bandKey,content:input.content,do_push:input.doPush});}
    else url=q(`https://openapi.band.us/${kind==='bands'?'v2.1/bands':kind==='posts'?'v2/band/posts':'v2.1/band/post'}`,params);
  } else if(a==='kakao.message.self') {
    url=new URL('https://kapi.kakao.com/v2/api/talk/memo/default/send'); init.headers={...init.headers,Authorization:`Bearer ${s.accessToken}`};
    form({template_object:JSON.stringify({object_type:'text',text:input.text,link:{web_url:input.link,mobile_web_url:input.link},button_title:input.buttonTitle})});
  } else if(a.startsWith('kakao.map.')) {
    url=q(`https://dapi.kakao.com/v2/local/search/${a.endsWith('places')?'keyword':'address'}.json`,input);init.headers={...init.headers,Authorization:`KakaoAK ${s.restApiKey}`};
  } else if(a.startsWith('daum.search.')) {
    url=q(`https://dapi.kakao.com/v2/search/${a.split('.').at(-1)}`,input);init.headers={...init.headers,Authorization:`KakaoAK ${s.restApiKey}`};
  } else {
    url=q(`https://api.odcloud.kr/api/gov24/v3/${a.endsWith('list')?'serviceList':'serviceDetail'}`,a.endsWith('list')?{page:input.page,perPage:input.perPage,...(input.query?{'cond[서비스명::LIKE]':input.query}:{})}:{page:1,perPage:1,'cond[서비스ID::EQ]':input.serviceId});
    init.headers={...init.headers,Authorization:`Infuser ${s.serviceKey}`};
  }
  if(!action.domains.includes(url.hostname)) throw new ActionError('DOMAIN_DENIED','허용되지 않은 공급자 주소입니다.');
  return {url,init};
}
export function officialExecutor(fetcher: typeof fetch = fetch): Executor {
  return async (action, context) => {
    assertActionAvailable(action);
    const {url,init}=buildRequest(action,context);
    if(context.signal.aborted) throw new ActionError('CANCELLED','작업이 취소됐습니다.','cancelled');
    context.dispatch();
    const response=await fetcher(url, {...init,signal:AbortSignal.any([context.signal,AbortSignal.timeout(30_000)])});
    if(response.status===401 || response.status===403) throw new ActionError('AUTH_REQUIRED','공급자 인증 또는 권한을 확인하고 계정을 갱신하세요.','awaiting_auth');
    if(!response.ok) throw new ActionError(`PROVIDER_HTTP_${response.status}`,`공급자 HTTP ${response.status} 응답`,action.effect==='write' && response.status>=500?'needs_review':'failed');
    const raw=await response.text();
    if(raw.length>2_000_000) throw new ActionError('RESULT_TOO_LARGE','결과가 너무 큽니다.',action.effect==='write'?'needs_review':'failed');
    let data: any; try { data=JSON.parse(raw); } catch { throw new ActionError('INVALID_RESPONSE','공급자 응답 형식을 확인할 수 없습니다.',action.effect==='write'?'needs_review':'failed'); }
    let valid=false;
    if(action.id.startsWith('band.')) { valid=data.result_code===1 && data.result_data!=null; if(action.effect==='write')valid=valid && typeof data.result_data?.post_key==='string'; }
    else if(action.id==='kakao.message.self') valid=data.result_code===0;
    else if(action.id.startsWith('naver.cafe.')) { valid=String(data.message?.status)==='200'; if(action.id.endsWith('publish'))valid=valid && !!data.message?.result?.articleId; }
    else if(action.id==='naver.calendar.create') valid=data.result==='success' && data.returnValue?.icalUid===`${context.job.id}@koreai.local`;
    else if(action.id.startsWith('naver.search.')) valid=Array.isArray(data.items);
    else if(action.id.startsWith('gov.')) valid=Array.isArray(data.data);
    else valid=Array.isArray(data.documents);
    if(!valid) {
      const code=String(data.errorCode??data.code??data.result_code??data.result?.code??data.message?.error?.code??'UNKNOWN');
      if(['024','401','-401','42'].includes(code)) throw new ActionError('AUTH_REQUIRED','접근 토큰이 만료됐거나 권한이 없습니다.','awaiting_auth');
      throw new ActionError('PROVIDER_RESULT_UNCONFIRMED','정상 결과를 확인하지 못했습니다. 공급자 화면에서 결과를 확인하세요.',action.effect==='write'?'needs_review':'failed');
    }
    return {data:redact(data,Object.values(context.secrets)),evidence:action.resultCheck};
  };
}
