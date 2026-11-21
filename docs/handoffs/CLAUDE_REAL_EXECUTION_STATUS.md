# 실제 실행 백엔드 — 진행 상태와 조율 요청

작성: Claude(백엔드). 기준일: 2026-11-21. 요청서: [CLAUDE_REAL_EXECUTION.md](CLAUDE_REAL_EXECUTION.md).

**결론: 실제 앱 생성·검증·배포 경로는 아직 실행할 수 없다.** 필요한 결정 3건이 미정이고 공급자 자격 증명이 모두 비어 있다. 이 문서의 "구현됨"은 실제 외부 서비스로 확인한 것이 아니라 가짜 공급자와 테스트 DB로 확인한 기반 부분이다. "백엔드 완료"로 읽지 않는다.

## 1. 지금 막힌 이유 (사실 확인, 비밀값 출력 없음)

| 항목                     | 상태                                                                          | 풀려면                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| LLM 연결                 | `LLM_API_KEY` 비어 있음. 연결 방식 미정                                       | **DEC-002 결정**: API 직접 호출 또는 기존 코딩 도구 연계, 모델·비용 부담. 그다음 키 설정 |
| 코드 실행 환경(샌드박스) | 어댑터 없음. 환경 미정                                                        | **DEC-004 결정**: 실행 환경(예: Vercel Sandbox 후보)과 권한·네트워크·한도                |
| GitHub                   | `GITHUB_TOKEN` 비어 있음, 저장소 생성·반영 어댑터 없음                        | 토큰 설정, 대상(사용자/조직)과 공개 범위 승인, 어댑터 구현                               |
| Vercel                   | `VERCEL_TOKEN` 비어 있음, 배포 어댑터 없음                                    | 토큰 설정, 대상 팀 승인, 어댑터 구현                                                     |
| Supabase                 | `SUPABASE_ACCESS_TOKEN` 비어 있음, DB 생성 어댑터 없음. 조직·지역·요금제 미정 | **DEC-005 결정**, 토큰 설정, 어댑터 구현                                                 |
| 실행 한도                | 모델 호출 횟수·예상 비용 한도 미설정                                          | 설정 화면에서 값 입력(DEC-006). 미설정 한도로는 시작하지 않는다                          |

필요한 환경변수 이름(값은 `.env`에만): `LLM_API_KEY`, `GITHUB_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `WORKER_DEMO_DELAY_MS`(과거 시뮬레이터용). 개발 DB와 별도로 `TEST_DATABASE_URL`(선택).

유료 외부 실행, 공개 배포, 외부 리소스 생성은 구체적 대상 승인이 없어서 어떤 것도 실행하지 않았다.

## 2. 구현한 것 (기반)

| 요구                            | 구현                                                                                                                                                                                                                                                                               | 확인 방법                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 4. 준비 상태가 실제를 반영      | `domain/readiness.ts`, `infrastructure/integrations/readiness.ts`, `adapters.ts`. 어댑터·결정·자격 증명·연결 확인(24시간 이내)·한도 설정을 모두 만족해야 `available: true`. 토큰만 있어도, 연결 확인만 되어도 준비되지 않음. 이유 문장에 필요한 항목 이름이 들어가고 비밀값은 없음 | `tests/readiness.test.ts`                                   |
| 5. 외부 작업 결과 불명확·재조정 | `application/external-operations.ts` + `external-operation-store.ts`. 작업 키 충돌 거절, `UNKNOWN`은 재요청 전에 조회, 없음이 확인될 때만 재요청, 조회 실패 시 정지, 동시 요청은 외부 호출 1회, 요청 중으로 남은 작업은 새로 시작하지 않고 오래되면 `UNKNOWN` 전환                 | `tests/external-operations.test.ts`(테스트 DB, 가짜 공급자) |
| 5. 한도                         | `domain/limits.ts`. 한도 0은 허용 안 함, 대기 시간은 작업 시간에 불포함. 시작 시 0이면 `LIMIT_REACHED`, REAL 재개·재시도 시 사용량이 한도에 이르렀으면 `LIMIT_REACHED`                                                                                                             | `tests/limits.test.ts`                                      |
| 3. 비밀값 유출 방지             | `domain/secrets.ts`. 로그·실패 사유 가림(워커에 연결), 소스 파일 검사(`findSecretLeaks`), `.env*` 파일 업로드 금지 판단. **저장소 반영 단계에서 호출해야 함**                                                                                                                      | `tests/secrets.test.ts`                                     |
| 7. 별도 테스트 DB               | `tests/helpers/test-database.ts`. DB 테스트는 이름에 `test`가 든 DB에서만 실행. 개발 DB는 건드리지 않음                                                                                                                                                                            | 전체 133건 통과, 개발 DB 행 수 변화 없음                    |
| 6. 기존 정상 배포 보존          | 마지막 정상 배포는 실행이 `SUCCEEDED`일 때만 갱신(기존 구현 유지). 결과 판단은 저장된 검증 결과와 배포 기록만 사용                                                                                                                                                                 | `tests/api-office.test.ts`(결과·검증)                       |

## 3. 구현하지 못한 것

- 실제 LLM 역할 수행과 회의 발언 생성(2번): 공급자·연결 방식 미정(DEC-002)이라 만들지 않았다. 지금 워커의 회의 대본은 과거 시뮬레이터이며 신규 실행 경로에서 쓰이지 않는다. 결정 후 `workflow-steps.ts`의 내용 생성부를 LLM 구현으로 교체한다(단계 순서·결정·회의 저장·SSE는 재사용).
- 격리된 작업 공간에서 빌드·테스트(3번), GitHub 저장소 생성·반영, Vercel 배포, Supabase DB 생성: 어댑터 없음. 외부 작업은 모두 위 원장(`runExternalOperation`)을 거치도록 구현해야 한다.
- 실행 중 모델 호출 단위의 한도 차단(호출 전 확인·사용량 기록): LLM 클라이언트가 생길 때 함께 구현한다.

## 4. 조율이 필요한 공유 파일 (수정하지 않음)

1. **`src/contracts/health.ts` — `ExecutionReadiness`에 선택 필드 추가 제안**
   ```ts
   requirements?: { id: "LLM"|"SANDBOX"|"GITHUB"|"VERCEL"|"SUPABASE"|"LIMITS"; label: string; ready: boolean; blockers: string[] }[];
   ```
   호환 추가(기존 `{ available, reason }` 유지)다. 백엔드는 이미 계산하고 있어(`ReadinessAssessment`) 필드만 열면 프론트가 항목별 해결 행동(설정 이동 등)을 붙일 수 있다. UI_UX_REVIEW 17번과 연결된다. 승인되면 route에 한 줄만 추가한다.
2. **`docs/API.md`**: `reason`이 항목별 이유 문장으로 바뀌었고, `LIMIT_REACHED`(시작 시 한도 0, REAL 재개·재시도 시 한도 도달)가 실제로 반환된다는 점을 기록해야 한다.
3. **`package.json`/lockfile**: 이번에는 변경하지 않았다. LLM·샌드박스·공급자 SDK는 DEC-002/004 결정 후 필요 여부를 정한다.

## 5. 프론트에서 연결할 사항

- `GET /api/runs/readiness`의 `reason`을 그대로 보여 주되, 길이가 길어질 수 있다(항목별로 `이름(이유, 이유)`를 `·`로 이음). 항목별 UI는 위 1번 승인 후.
- 시작·재개·재시도에서 `LIMIT_REACHED`(422)가 올 수 있다. 메시지는 한도 이름을 포함한다.
- `INTEGRATION_NOT_CONFIGURED`(422)의 메시지는 readiness의 이유와 같다.
- 연결 확인(`POST /settings/connections/:provider/verify`)은 24시간 안의 `CONNECTED`만 준비로 인정한다. 오래된 확인은 다시 하도록 안내한다.

## 6. 수행한 테스트

`npm test` 전체 133건 통과(테스트 DB `mvpfactory_test`). 새로 추가: `readiness`(5), `external-operations`(7), `limits`(5), `secrets`(4). 기존 `api`·`api-office`·`worker` DB 테스트도 테스트 DB에서 통과했다(Codex 변경 후 처음 실제 실행). 실제 외부 서비스는 호출하지 않았다.
