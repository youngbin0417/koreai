import { animalHospitalRegions } from '../src/research/animal-hospital-regions';

export const animalHospitalSourceUrl = 'https://www.data.go.kr/data/15045050/fileData.do';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';

export function animalHospitalInputState(input: string): { value: Record<string, unknown> | null; error: string | null } {
  let value: unknown;
  try { value = JSON.parse(input); } catch { return { value: null, error: 'JSON 입력을 올바르게 수정하면 조건 입력을 사용할 수 있습니다.' }; }
  if (!object(value)) return { value: null, error: 'JSON 입력은 검색 조건 객체여야 합니다.' };
  const fail = (error: string) => ({ value, error }) as { value: Record<string, unknown>; error: string };
  if (Object.keys(value).some(key => !['region', 'query', 'status', 'page', 'limit'].includes(key))) return fail('지원하지 않는 JSON 항목을 삭제하세요.');
  if (!animalHospitalRegions.some(region => region.name === value.region)) return fail('공식 목록에서 조회할 지역을 선택하세요.');
  if (value.query !== undefined && (typeof value.query !== 'string' || !value.query.trim() || value.query.trim().length > 100)) return fail('병원명은 비워 두거나 1~100자로 입력하세요.');
  if (value.status !== undefined && value.status !== 'normal' && value.status !== 'all') return fail('인허가 상태를 선택하세요.');
  if (!integer(value.page === undefined ? 1 : value.page, 1, 1000)) return fail('페이지는 1~1,000 사이의 정수로 입력하세요.');
  if (!integer(value.limit === undefined ? 10 : value.limit, 1, 50)) return fail('한 번에 볼 건수는 1~50 사이의 정수로 입력하세요.');
  return { value, error: null };
}

interface Hospital {
  managementId: string; name: string;
  registration: { code: string; name: string; detailCode: string; detail: string };
  roadAddress: string | null; lotAddress: string | null; phone: string | null;
  permissionDate: string | null; closureDate: string | null;
  dataUpdatedAtRaw: string | null; lastModifiedAtRaw: string | null;
}
interface HospitalData {
  status: 'available' | 'no_data'; reason?: 'no_match' | 'empty_page';
  region: { name: string; code: string }; hospitals: Hospital[];
  totalSourceRows: number; totalMatches: number;
  pagination: { page: number; limit: number; hasMore: boolean };
  retrievedAt?: string;
}
// Jobs from older/unknown connector versions retain their JSON instead of breaking the dialog.
export function animalHospitalResultData(result: unknown): HospitalData | null {
  if (!object(result) || result.contentTrust !== 'external_data' || !object(result.data)) return null;
  const data = result.data, region = data.region, pagination = data.pagination;
  if (!object(region) || !animalHospitalRegions.some(r => r.name === region.name && r.code === region.code)) return null;
  if (data.status !== 'available' && data.status !== 'no_data' || !Array.isArray(data.hospitals) || data.hospitals.length > 50) return null;
  if (data.status === 'no_data' && data.reason !== 'no_match' && data.reason !== 'empty_page') return null;
  if (!integer(data.totalMatches, 0, 20_000) || !integer(data.totalSourceRows, data.totalMatches, 20_000)) return null;
  if (!object(pagination) || !integer(pagination.page, 1, 1000) || !integer(pagination.limit, 1, 50) || typeof pagination.hasMore !== 'boolean') return null;
  if (!data.hospitals.every(row => object(row) && typeof row.managementId === 'string' && typeof row.name === 'string' && object(row.registration) &&
    ['code', 'name', 'detailCode', 'detail'].every(key => typeof (row.registration as Record<string, unknown>)[key] === 'string') &&
    ['roadAddress', 'lotAddress', 'phone', 'permissionDate', 'closureDate', 'dataUpdatedAtRaw', 'lastModifiedAtRaw'].every(key => nullableText(row[key])))) return null;
  if (data.retrievedAt !== undefined && typeof data.retrievedAt !== 'string') return null;
  return data as unknown as HospitalData;
}

const seoulTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function animalHospitalTime(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? seoulTime.format(new Date(value)) + ' (한국 시간)' : '기록 없음';
}
