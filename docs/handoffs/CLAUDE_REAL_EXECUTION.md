# Claude 작업 요청 — 실제 실행 백엔드

Codex와 **같은 브랜치에서 동시에 작업** 중입니다. 먼저 루트 AGENTS.md와 현재 git diff, docs/UI_UX_REVIEW.md, docs/API.md 마지막 실행 정책 변경을 읽으세요. 다른 작업자의 변경을 되돌리거나 전체 포맷 변경·브랜치 전환·전체 스테이징하지 마세요.

## 목표

데모를 실제 생성으로 가장하지 않고, 사용자가 입력한 프로젝트 기획으로 실제 앱 코드를 만들고 검증·저장·배포하는 실행 경로를 구현하세요. 현재 createIntegrationReadiness()는 항상 false이고 workflow-steps.ts는 demo-content 기반입니다. 데모 UI 선택지는 Codex가 제거했고 신규 DEMO 접수 및 resume/retry는 서버에서도 차단했습니다. 과거 데모 기록은 보존합니다.

## 소유 범위

Claude: src/application/**, src/domain/**, src/infrastructure/**, src/server/**, src/worker.ts, src/app/api/**, prisma/** 및 해당 백엔드 테스트.
Codex: src/components/**, src/hooks/**, src/styles/**, 프론트 화면·사용성 개선, docs/UI_UX_REVIEW.md.

공유 파일(src/contracts/**, package.json/lockfile, tsconfig, docs/API.md)은 변경 필요성과 계약을 먼저 정리하고 사용자에게 알려 조율하세요. 프론트 파일은 수정하지 마세요. 계약의 필드 제거·이름 변경은 피하고 가능한 호환 추가로 진행하세요. 기존 src/app/api/runs/readiness/route.ts와 계약은 유지하세요.

## 요구사항

1. 실제 공급자 연동을 구현할 수 있는 현재 자격 증명·설정 여부를 비밀값 출력 없이 확인하세요. 공급자 선택은 기존 문서의 확정 결정에 따르고, 미정이거나 자격 증명이 없으면 필요한 결정·설정만 명시하세요. 유료 외부 실행·공개 배포·외부 리소스 생성은 구체적 대상이 승인되지 않았다면 자동으로 실행하지 마세요.
2. 실제 LLM 역할 수행 및 회의 발언을 저장하고 SSE로 전달하세요. 스크립트·가짜 URL·고정 산출물로 완료시키지 마세요. 발언은 프론트가 기존 Meeting 계약으로 읽을 수 있어야 합니다.
3. 생성 코드는 격리된 작업 공간에서 빌드/테스트하고, 공통 GitHub·DB·Vercel 기본 설정을 재사용하세요. 팩토리 비밀값이 생성 앱이나 로그에 유출되지 않게 하세요.
4. 실행 준비 상태는 실제 필요한 어댑터·설정·권한을 반영해야 합니다. readiness를 단순 true로 바꾸거나 토큰 존재만으로 준비 완료라고 하지 마세요. 불가능하면 available:false와 정확한 이유를 반환하세요.
5. 중복 방지 키, 중단·재개·재시도, 승인 버전 검사, 한도, 외부 작업 결과 불명확 상태와 재조정을 유지하세요.
6. 빌드 통과, 배포 성공, 실제 제품 요구사항 충족을 구분하세요. 최종 결과 링크와 검증 증거는 실제 결과만 사용하세요. 기존 정상 배포는 실패한 수정 작업으로 덮어쓰지 마세요.
7. 실행 가능한 범위를 구현하고 테스트하세요. 현재 테스트 중 DB의 실행 예약·작업 큐를 지우는 테스트가 있으므로 사용 중인 DB에서 그대로 돌리지 마세요. 별도 테스트 DB를 사용하세요.

## 현재 변경과 테스트 참고

- GET /api/runs/readiness → { available:boolean, reason:string|null }
- 신규 start body는 mode:REAL이며 DEMO는 400.
- 과거 DEMO resume/retry는 409. REAL resume/retry도 readiness 검사.
- tests/real-execution.test.ts: 위 계약 단위 테스트.
- tests/helpers/historical-run.ts: 과거 시뮬레이터 기록을 직접 생성하는 테스트 전용 fixture. 사용자용 실행 경로가 아닙니다.
- API 통합 테스트는 테스트 한정 readiness를 주입하고, 워커/과거 기록 테스트는 fixture를 사용하도록 조정됐습니다. 이 DB 통합 테스트는 최근 변경 후 실제 실행하지 않았습니다.

## 완료 보고

수정 파일, 실제 구현된 경로와 아직 막힌 경로, 필요한 환경변수 이름(값 제외), API 변경, 수행한 테스트, 프론트에서 연결할 사항을 정리하세요. ‘백엔드 완료’라는 표현은 실제 생성·검증·배포까지 확인한 범위에만 사용하세요.

## 사용자 요청으로 저장한 공통 실행 한도

2026-11-21: 설정 API로 모델 호출 50회, 자동 수정 3회, 작업 시간 1800초, 예상 비용 5를 저장했습니다. 새 실행 1회 기준입니다. 예상 비용은 **USD 기준으로 5달러**를 의도한 값입니다. 현재 Settings의 maxEstimatedCost에는 통화 필드가 없고 Run의 usageCostCurrency도 nullable이므로, 실제 비용 집계 구현 시 USD로 일치시키고 다른 통화의 숫자를 그대로 비교하지 마세요. 이 설정 저장 자체가 비용 집계/차단 구현 완료를 뜻하지는 않습니다.

## 추가 변경 — DB 초기화 후 기본 한도 유지

사용자 요청으로 `src/infrastructure/integrations/default-limits.ts`에 공통 한도 해석을 추가했습니다. `settings-repository.ts` 조회와 `run-repository.ts` 신규 Run 스냅샷 양쪽에서 `workspaceRunLimits`를 사용합니다. 각 필드 우선순위는 DB 값 → DEFAULT_MAX_* 환경변수 → 코드 기본값(50/3/1800/5)입니다. DB null은 기본값 상속, 0은 명시적 금지입니다. 진행 중/과거 Run 스냅샷은 바꾸지 않습니다. 이 두 저장소 파일을 수정할 때 새 공통 함수 호출을 보존해주세요.
