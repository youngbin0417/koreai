import { champriceDefaultMonth, champriceSnapshots } from '../src/research/champrice-snapshots';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

// JSON stays the single input source, including edits made in the advanced view.
export function champriceInputState(input: string): { value: Record<string, unknown> | null; error: string | null } {
  let value: unknown;
  try { value = JSON.parse(input); } catch { return { value: null, error: 'JSON 입력을 올바르게 수정하면 조건 입력을 사용할 수 있습니다.' }; }
  if (!object(value)) return { value: null, error: 'JSON 입력은 검색 조건 객체여야 합니다.' };
  const fail = (error: string) => ({ value, error }) as { value: Record<string, unknown>; error: string };
  const fields = ['month', 'productName', 'match', 'manufacturer', 'storeQuery', 'surveyDate', 'page', 'limit'];
  if (Object.keys(value).some(key => !fields.includes(key))) return fail('지원하지 않는 JSON 항목을 삭제하세요.');
  const month = value.month === undefined ? champriceDefaultMonth : value.month;
  if (!champriceSnapshots.some(snapshot => snapshot.month === month)) return fail('검토된 조사월을 선택하세요.');
  for (const [key, label, required] of [['productName', '상품명', true], ['manufacturer', '제조사', false], ['storeQuery', '판매업소', false]] as const) {
    const text = value[key];
    if (text === undefined && !required) continue;
    if (typeof text !== 'string' || !text.trim() || text.length > 100 || /\p{C}/u.test(text)) return fail(`${label}은 공백만 쓰거나 제어문자를 넣지 않고 1~100자로 입력하세요.`);
  }
  if (value.match !== undefined && (typeof value.match !== 'string' || !['contains', 'exact'].includes(value.match))) return fail('상품명 일치 방식을 선택하세요.');
  if (value.surveyDate !== undefined && (!date(value.surveyDate) || !value.surveyDate.startsWith(month + '-'))) return fail('조사일은 선택한 월 안의 실제 날짜로 입력하세요.');
  if (!integer(value.page === undefined ? 1 : value.page, 1, 10_000)) return fail('페이지는 1~10,000 사이의 정수로 입력하세요.');
  if (!integer(value.limit === undefined ? 10 : value.limit, 1, 50)) return fail('한 번에 볼 건수는 1~50 사이의 정수로 입력하세요.');
  return { value, error: null };
}

interface Price {
  sourceRow: number; productNameRaw: string; manufacturerRaw: string; storeNameRaw: string; surveyedOn: string;
  priceKrw: number; sale: boolean | null; onePlusOne: boolean | null;
}
interface PriceData {
  status: 'available' | 'no_data' | 'empty_page'; prices: Price[]; totalMatches: number; totalSourceRows: number;
  snapshot: { month: string; label: string; publishedOn: string };
  pagination: { page: number; limit: number; nextPage: number | null; pageLimitReached: boolean };
  retrievedAt?: string; queriedAt?: string;
  cache?: { status: string } | null;
}
// Historical/unknown results keep their JSON view instead of breaking the job dialog.
export function champriceResultData(result: unknown): PriceData | null {
  if (!object(result) || result.contentTrust !== 'external_data' || !object(result.data)) return null;
  const data = result.data, snapshot = data.snapshot, pagination = data.pagination;
  if (!object(snapshot) || !champriceSnapshots.some(s => s.month === snapshot.month) || typeof snapshot.label !== 'string' || typeof snapshot.publishedOn !== 'string') return null;
  if (typeof data.status !== 'string' || !['available', 'no_data', 'empty_page'].includes(data.status) || !Array.isArray(data.prices) || data.prices.length > 50) return null;
  if (!integer(data.totalMatches, 0, 300_000) || !integer(data.totalSourceRows, data.totalMatches, 300_000)) return null;
  if (!object(pagination) || !integer(pagination.page, 1, 10_000) || !integer(pagination.limit, 1, 50) || typeof pagination.pageLimitReached !== 'boolean') return null;
  if (pagination.nextPage !== null && (!integer(pagination.nextPage, 2, 10_000) || pagination.nextPage !== pagination.page + 1)) return null;
  const flag = (value: unknown) => value === null || typeof value === 'boolean';
  if (!data.prices.every(row => object(row) && integer(row.sourceRow, 1, 300_000) &&
    ['productNameRaw', 'manufacturerRaw', 'storeNameRaw'].every(key => typeof row[key] === 'string') && date(row.surveyedOn) &&
    integer(row.priceKrw, 0, 999_999_999_999) && flag(row.sale) && flag(row.onePlusOne))) return null;
  if (data.retrievedAt !== undefined && typeof data.retrievedAt !== 'string' || data.queriedAt !== undefined && typeof data.queriedAt !== 'string') return null;
  if (data.cache != null && (!object(data.cache) || typeof data.cache.status !== 'string')) return null;
  return data as unknown as PriceData;
}

const seoulTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function champriceTime(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? seoulTime.format(new Date(value)) + ' (한국 시간)' : '기록 없음';
}
