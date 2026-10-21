import { work24EmploymentTypes } from '../src/research/work24-reference';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const nullableText = (value: unknown) => value === null || typeof value === 'string';

export interface Work24RegionSelection { code: string; name: string; parentName: string | null; retrievedAt?: string }
export function applyWork24Region(input: string, selection: Work24RegionSelection): string {
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('기존 채용공고 검색의 JSON 입력을 수정한 뒤 지역을 다시 선택하세요.'); }
  if (!object(value) || !/^\d{5}$/.test(selection.code)) throw new Error('채용공고 조건과 지역 코드를 확인하세요.');
  return JSON.stringify({ ...value, regionCode: selection.code, page: 1 }, null, 2);
}

export function work24InputState(input: string): { value: Record<string, unknown> | null; error: string | null } {
  let value: unknown;
  try { value = JSON.parse(input); } catch { return { value: null, error: 'JSON 입력을 올바르게 수정하면 조건 입력을 사용할 수 있습니다.' }; }
  if (!object(value)) return { value: null, error: 'JSON 입력은 검색 조건 객체여야 합니다.' };
  const fail = (error: string) => ({ value, error }) as { value: Record<string, unknown>; error: string };
  if (Object.keys(value).some(key => !['keyword', 'regionCode', 'employmentType', 'page', 'limit'].includes(key))) return fail('지원하지 않는 JSON 항목을 삭제하세요.');
  if (typeof value.keyword !== 'string' || !value.keyword.trim() || value.keyword.length > 100 || /[|,\p{C}]/u.test(value.keyword)) return fail('검색어는 쉼표·파이프·제어문자 없이 1~100자로 입력하세요.');
  if (value.regionCode !== undefined && (typeof value.regionCode !== 'string' || !/^\d{5}$/.test(value.regionCode))) return fail('근무지역은 공식 목록에서 선택하거나 5자리 코드로 입력하세요.');
  if (value.employmentType !== undefined && !work24EmploymentTypes.some(type => type.code === value.employmentType)) return fail('지원하는 고용형태를 선택하세요.');
  if (!integer(value.page === undefined ? 1 : value.page, 1, 1000)) return fail('페이지는 1~1,000 사이의 정수로 입력하세요.');
  if (!integer(value.limit === undefined ? 10 : value.limit, 1, 100)) return fail('한 번에 볼 건수는 1~100 사이의 정수로 입력하세요.');
  return { value, error: null };
}

interface Work24Job {
  jobId: string; company: string; title: string; regionRaw: string;
  salary: { formRaw: string | null; textRaw: string | null; minimumRaw: string | null; maximumRaw: string | null };
  workScheduleRaw: string | null; educationMinimumRaw: string | null; educationMaximumRaw: string | null;
  careerRaw: string | null; registeredOnRaw: string | null; deadlineRaw: string | null;
  providerModifiedAtRaw: string | null; sourceProviderRaw: string | null; employmentTypeRaw: string | null;
  url: string | null; sourceLinkVerified: boolean;
}
interface Work24Data {
  status: 'available' | 'no_data' | 'empty_page'; jobs: Work24Job[];
  pagination: { page: number; limit: number; total: number; returnedCount: number; nextPage: number | null; partialPage: boolean };
  retrievedAt?: string;
}
export function work24ResultData(result: unknown): Work24Data | null {
  if (!object(result) || result.contentTrust !== 'external_data' || !object(result.data)) return null;
  const data = result.data, page = data.pagination;
  if (!['available', 'no_data', 'empty_page'].some(status => status === data.status) || !Array.isArray(data.jobs) || data.jobs.length > 100) return null;
  if (!object(page) || !integer(page.page, 1, 1000) || !integer(page.limit, 1, 100) || !integer(page.total, 0, 100_000_000) || page.returnedCount !== data.jobs.length || typeof page.partialPage !== 'boolean') return null;
  if (page.nextPage !== null && (!integer(page.nextPage, 2, 1000) || page.nextPage !== page.page + 1)) return null;
  if (!data.jobs.every(job => object(job) && typeof job.jobId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(job.jobId) &&
    ['company', 'title', 'regionRaw'].every(key => typeof job[key] === 'string') && object(job.salary) &&
    ['formRaw', 'textRaw', 'minimumRaw', 'maximumRaw'].every(key => nullableText((job.salary as Record<string, unknown>)[key])) &&
    ['workScheduleRaw', 'educationMinimumRaw', 'educationMaximumRaw', 'careerRaw', 'registeredOnRaw', 'deadlineRaw', 'providerModifiedAtRaw', 'sourceProviderRaw', 'employmentTypeRaw', 'url'].every(key => nullableText(job[key])) && typeof job.sourceLinkVerified === 'boolean')) return null;
  if (data.retrievedAt !== undefined && typeof data.retrievedAt !== 'string') return null;
  return data as unknown as Work24Data;
}

const seoulTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function work24Time(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? seoulTime.format(new Date(value)) + ' (한국 시간)' : '기록 없음';
}
