import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ActionError, type Action, type Executor } from '../types.js';
import { work24Docs, work24SourceLink } from '../research/work24-reference.js';
export const work24Endpoint = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
export { work24Docs } from '../research/work24-reference.js';
export const work24Schema = z.object({ keyword: z.string().min(1).max(100).refine(v => !/[|,\p{C}]/u.test(v), '검색어는 제어문자·다중 구분자 없이 입력하세요.').transform(v => v.trim()).pipe(z.string().min(1)), regionCode: z.string().regex(/^\d{5}$/).optional(), employmentType: z.enum(['10', '11', '20', '21']).optional(), page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(100).default(10) }).strict();
export const work24Action: Action = { id: 'work24.jobs.search', serviceId: 'work24', connectorId: 'work24-jobs-api', title: '고용24 채용공고 찾기', description: '승인받은 기업회원 API 키로 검색어·지역 코드·고용형태에 따른 채용공고 목록 한 페이지를 조회합니다. 회사·제목·근무지역·급여/마감 원문과 검증 가능한 원문 링크를 반환하며 이력서·지원·개인 추천은 수행하지 않습니다.', category: '교육·취업', effect: 'read', method: 'api', schema: work24Schema, inputSchema: zodToJsonSchema(work24Schema, { $refStrategy: 'none' }) as Record<string, unknown>, credentialType: 'work24-api', requiredSecrets: ['authKey'], scopes: [], sourceUrl: work24Docs, checkedAt: '2026-10-21', verification: 'documented', resultCheck: 'XML·공급자 오류·페이지/출력 수·총건수·구인인증번호 중복·제공된 고용형태와 원문 링크의 인증번호를 검증합니다. 급여·날짜·채용시까지는 원문으로 보존하며 검색어/지역의 전체 내용 일치는 미확인입니다.', domains: ['www.work24.go.kr'], version: '0.1.0', maintainer: 'KoreAI', origin: 'bundled', implemented: true };
export function work24Example() { return { keyword: '개발자', page: 1, limit: 10 }; }
export function work24RequestTemplate(raw: unknown) { const input = work24Schema.parse(raw); return { method: 'GET' as const, endpoint: work24Endpoint, query: { callTp: 'L', returnType: 'XML', startPage: input.page, display: input.limit, keyword: input.keyword, sortOrderBy: 'DESC', ...(input.regionCode ? { region: input.regionCode } : {}), ...(input.employmentType ? { empTp: input.employmentType } : {}) }, authentication: { secretField: 'authKey' as const, queryParameter: 'authKey' }, responseFormat: 'xml' as const }; }
const invalid = () => new ActionError('INVALID_RESPONSE', '고용24 응답의 XML·목록·페이지·구인인증번호가 유효하지 않습니다.');
const text = z.string().max(4000), id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), integer = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(100000000));
const rowSchema = z.object({ wantedAuthNo: id, company: text.min(1), title: text.min(1), region: text.min(1), salTpNm: text.nullish(), sal: text.nullish(), minSal: text.nullish(), maxSal: text.nullish(), holidayTpNm: text.nullish(), minEdubg: text.nullish(), maxEdubg: text.nullish(), career: text.nullish(), regDt: text.nullish(), closeDt: text.nullish(), infoSvc: text.nullish(), wantedInfoUrl: text.nullish(), empTpCd: z.string().regex(/^(?:\d{1,3})?$/).nullish(), jobsCd: z.string().regex(/^(?:\d{1,10})?$/).nullish(), smodifyDtm: text.nullish() });
const parser = new XMLParser({ parseTagValue: false, trimValues: true, ignoreAttributes: true, ignoreDeclaration: true, processEntities: { enabled: true, maxTotalExpansions: 10000, maxExpandedLength: 100000 } });
const optional = (value: string | null | undefined) => value || null;
export function normalizeWork24Response(raw: string, rawInput: unknown) {
    const input = work24Schema.parse(rawInput);
    if (raw.length > 2000000)
        throw new ActionError('RESULT_TOO_LARGE', '고용24 응답이 너무 큽니다.');
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true)
        throw invalid();
    let root: any;
    try {
        root = parser.parse(raw);
    }
    catch {
        throw invalid();
    }
    if (root?.GO24) {
        const error = z.object({ error: z.string().min(1).max(4000) }).safeParse(root.GO24);
        if (!error.success)
            throw invalid();
        if (error.data.error.replace(/\s+/g, ' ').trim() === '신청하신 OpenApi 서비스가 존재하지 않습니다')
            throw new ActionError('WORK24_SERVICE_ACCESS_REQUIRED', '고용24 기업회원·채용정보 서비스 심사/신청과 인증키를 확인한 뒤 재개하세요.', 'awaiting_auth');
        throw new ActionError('WORK24_PROVIDER_ERROR', '고용24가 정상 채용정보를 반환하지 않았습니다. 조회 조건·신청 상태·서비스를 확인하세요.');
    }
    const envelope = z.object({ total: integer, startPage: integer, display: integer, wanted: z.unknown().optional() }).safeParse(root?.wantedRoot);
    if (!envelope.success)
        throw invalid();
    const e = envelope.data;
    const rows = z.array(rowSchema).max(input.limit).safeParse(e.wanted === undefined || e.wanted === '' ? [] : Array.isArray(e.wanted) ? e.wanted : [e.wanted]);
    if (!rows.success || e.startPage !== input.page || e.display !== input.limit)
        throw invalid();
    const offset = (input.page - 1) * input.limit;
    if (rows.data.length && offset + rows.data.length > e.total || !rows.data.length && offset < e.total)
        throw invalid();
    const seen = new Set<string>();
    const jobs = rows.data.map(row => {
        if (seen.has(row.wantedAuthNo) || input.employmentType && row.empTpCd && row.empTpCd !== input.employmentType)
            throw invalid();
        seen.add(row.wantedAuthNo);
        const link = work24SourceLink(row.wantedInfoUrl, row.wantedAuthNo);
        return { jobId: row.wantedAuthNo, company: row.company, title: row.title, regionRaw: row.region,
            salary: { formRaw: optional(row.salTpNm), textRaw: optional(row.sal), minimumRaw: optional(row.minSal), maximumRaw: optional(row.maxSal), normalizedAmount: null, normalizedUnit: null }, workScheduleRaw: optional(row.holidayTpNm), educationMinimumRaw: optional(row.minEdubg), educationMaximumRaw: optional(row.maxEdubg), careerRaw: optional(row.career), registeredOnRaw: optional(row.regDt), deadlineRaw: optional(row.closeDt), providerModifiedAtRaw: optional(row.smodifyDtm), sourceProviderRaw: optional(row.infoSvc), employmentTypeRaw: optional(row.empTpCd), occupationCodeRaw: optional(row.jobsCd), url: link, sourceLinkVerified: link !== null, currentlyAcceptingApplications: null };
    });
    return { status: jobs.length ? 'available' : e.total ? 'empty_page' : 'no_data', query: input, jobs, pagination: { page: input.page, limit: input.limit, total: e.total, returnedCount: jobs.length, nextPage: offset + jobs.length < e.total && input.page < 1000 ? input.page + 1 : null, partialPage: jobs.length < input.limit && offset + jobs.length < e.total }, queryMatchVerified: false, retrievedAt: new Date().toISOString(),
        dataNote: '공급자 채용공고 목록이며 개인 지원 자격·추천·현재 모집 여부를 판정하지 않습니다. 급여는 임금형태/금액/단위·협의 조건을 원문으로 확인하고 환산하지 않습니다. 날짜·채용시까지·마감 상태는 원문이며 검색어/지역 일치는 반환된 요약만으로 확정하지 않습니다. 원문 링크는 HTTPS·공식 호스트·구인인증번호가 일치할 때만 표시하고 따라 읽지 않습니다. 사업자등록번호·지원자/담당자 개인정보는 반환하지 않습니다.', source: { name: '고용24 · 고용노동부/한국고용정보원', url: work24Docs, attribution: '출처: 고용24 채용정보 Open API' } };
}
async function readBody(response: Response) {
    const reader = response.body?.getReader();
    if (!reader)
        throw invalid();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let raw = '', bytes = 0;
    try {
        for (;;) {
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > 2000000)
                throw new ActionError('RESULT_TOO_LARGE', '고용24 응답이 너무 큽니다.');
            raw += decoder.decode(part.value, { stream: true });
        }
        return raw + decoder.decode();
    }
    catch (error) {
        try {
            await reader.cancel();
        }
        catch { /* Keep original error. */ }
        if (error instanceof TypeError)
            throw invalid();
        throw error;
    }
    finally {
        reader.releaseLock();
    }
}
export function work24Executor(fetcher: typeof fetch = fetch): Executor {
    return async (action, context) => {
        if (action.id !== work24Action.id)
            throw new ActionError('NOT_IMPLEMENTED', '고용24 실행기에 등록되지 않은 행동입니다.');
        const input = work24Schema.parse(context.job.input), template = work24RequestTemplate(input), key = context.secrets.authKey?.trim();
        if (!key || key.length > 4096 || /[^\x21-\x7e]/.test(key))
            throw new ActionError('AUTH_REQUIRED', '고용24에서 승인받은 채용정보 인증키를 등록하세요.', 'awaiting_auth');
        if (context.signal.aborted)
            throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
        const url = new URL(work24Endpoint);
        for (const [k, v] of Object.entries(template.query))
            url.searchParams.set(k, String(v));
        url.searchParams.set('authKey', key);
        const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30000)]);
        try {
            context.dispatch();
            const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/xml' }, redirect: 'error', cache: 'no-store', signal });
            if ([401, 403].includes(response.status))
                throw new ActionError('AUTH_REQUIRED', '고용24 키·기업회원·채용정보 승인 권한을 확인하세요.', 'awaiting_auth');
            if (response.status === 429)
                throw new ActionError('PROVIDER_RATE_LIMIT', '고용24 호출 한도를 초과했습니다. 자동 재시도하지 않습니다.');
            if (!response.ok)
                throw new ActionError(`PROVIDER_HTTP_${response.status}`, '고용24가 정상 응답을 반환하지 않았습니다.');
            const data = normalizeWork24Response(await readBody(response), input);
            if (context.signal.aborted)
                throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
            return { data, evidence: work24Action.resultCheck };
        }
        catch (error) {
            if (context.signal.aborted)
                throw new ActionError('CANCELLED', '작업이 취소됐습니다.', 'cancelled');
            if (error instanceof ActionError)
                throw error;
            if (signal.aborted || error instanceof Error && error.name === 'TimeoutError')
                throw new ActionError('PROVIDER_TIMEOUT', '고용24 조회 시간이 초과됐습니다.');
            throw new ActionError('PROVIDER_UNAVAILABLE', '고용24 연결·응답을 확인하지 못했습니다.');
        }
    };
}
