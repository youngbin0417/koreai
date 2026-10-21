import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { animalHospitalRegions, animalHospitalRegionSource } from '../src/research/animal-hospital-regions.js';

export const animalHospitalHeaders = ['개방자치단체코드','관리번호','사업장명','영업상태코드','영업상태명','상세영업상태코드','상세영업상태명','인허가일자','폐업일자','도로명주소','지번주소','전화번호','데이터갱신시점','최종수정시점','좌표정보(X)','좌표정보(Y)'];
export const animalHospitalRow = () => ['3220000','001234','시험, 동물병원','01','영업/정상','0000','정상','2020-01-01','','서울특별시 강남구 시험로 1','서울특별시 강남구 시험동','02-000-0000','2026-10-17 22:02:00','2026-10-16 15:53:45','204264.267630355','446792.780552867'];
const escape = (value: string) => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"','""') + '"' : value;
export const animalHospitalCsv = (rows = [animalHospitalRow()]) => [animalHospitalHeaders, ...rows].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
export const animalHospitalBytes = (rows = [animalHospitalRow()]) => new Uint8Array(iconv.encode(animalHospitalCsv(rows),'cp949'));
export function animalHospitalMock(rows = [animalHospitalRow()]) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (address, init) => {
    const url = new URL(String(address));calls.push(url);
    assert.equal(url.origin,'https://file.localdata.go.kr');assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('Referer'),animalHospitalRegionSource);
    assert.equal(new Headers(init.headers).get('Authorization'),null);assert.equal(new Headers(init.headers).get('Cookie'),null);
    if (url.pathname === '/file/validate/download-count') { assert.equal(url.search,'');return new Response(); }
    assert.equal(url.pathname,'/file/download/animal_hospitals/info');assert.equal(url.searchParams.size,1);
    const region = animalHospitalRegions.find(region => region.code === url.searchParams.get('orgCode'));assert(region);
    return new Response(animalHospitalBytes(rows.map(row => {const copy = [...row];copy[0] = region.code;return copy;})),{headers:{'Content-Type':'text/csv;charset=UTF-8'}});
  };
  return {calls,fetcher};
}
