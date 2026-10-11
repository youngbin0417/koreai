# 로컬 커넥터 확장

이 디렉터리는 확장 개발 안내입니다. 실행 코드는 `src/connectors/custom/`에 두고 `src/connectors/extensions.ts`에서 명시적으로 가져옵니다.

```sh
npm run connector:new -- --id hira-hospitals --service-id hira --name '병원 검색' --dry-run
npm run connector:new -- --id hira-hospitals --service-id hira --name '병원 검색'
```

초안은 `implemented: false`, `verification: 'unresearched'`로 생성됩니다. 기존 파일은 덮어쓰지 않고 자동 등록·네트워크 호출도 수행하지 않습니다. 서비스 ID는 조사 카탈로그의 ID를 사용하세요. 새로운 서비스는 먼저 `src/catalog.ts`에 조사 대상으로 추가합니다.

공식 근거·권한·입출력·결과 확인을 구현하고 모의 테스트를 추가한 뒤 소스를 검토합니다. `src/connectors/extensions.ts`에 다음과 같이 등록하면 재시작 후 공통 계정·승인·작업 엔진을 사용합니다.

```ts
import { extension as hiraHospitals } from './custom/hira-hospitals.js';
export const reviewedExtensions: ReviewedExtension[] = [hiraHospitals];
```

위 예시는 **등록 방법**이며 HIRA 연동을 구현했다는 뜻은 아닙니다. 구현 중인 초안도 등록할 수 있지만 실행은 비활성 상태로 유지됩니다. 검토된 실행 코드가 준비되면 `implemented: true`로 변경합니다. 실제 계정 검증과 배포 지원 지정은 별도로 수행합니다.

정적 확장은 엔진과 같은 OS 권한으로 실행되는 신뢰 코드입니다. `domains`는 선언 정보이며 네트워크 격리를 대신하지 않습니다. 커넥터가 고정된 허용 주소만 호출하도록 작성하고 검토해야 합니다. 에이전트가 임의 패키지를 설치하거나 파일을 동적으로 로드하는 API는 제공하지 않습니다. MCP 서버 연결은 관리 화면의 별도 등록·권한·승인 절차를 이용하세요.

구현 계약과 검증 항목은 [커넥터 개발](../docs/CONNECTORS.md), 다음 조사 후보는 [확장 순서](../docs/ROADMAP.md)를 참고하세요.
