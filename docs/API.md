# MVP 팩토리 API

| 항목      | 내용                                                                              |
| --------- | --------------------------------------------------------------------------------- |
| 파일·버전 | API.md · 0.1                                                                      |
| 작성일    | 2026년 11월 21일                                                                  |
| 상태      | **초안.** 화면과 서버가 함께 쓰는 계약. 워커가 만드는 동작을 제외하고 구현됨(§14) |
| 기준      | MVP_FACTORY_PRD.md v0.2, ARCHITECTURE.md, WORKFLOW.md                             |
| 담당 범위 | 공통·실행·결정·이벤트·설정 계약. 가상 회사(§8)는 화면 담당과 협의해 확정          |
| 타입      | 이 문서의 타입은 `src/contracts/`에 있다. 서로 다르면 이 문서가 기준이다          |

**한눈에 보기**

- **형식:** `/api` 아래 JSON. 로그인이 없으므로 인증 헤더는 없고, 브라우저 변경 요청은 같은 출처(Origin)만 허용한다.
- **실시간:** 진행 상황은 SSE로 받는다(`/api/runs/:id/stream`). 같은 이벤트를 `?after=<순번>` 일반 조회로도 읽는다.
- **중복 방지:** 실행 시작처럼 만드는 요청은 `Idempotency-Key`, CEO 응답은 결정 ID와 제안 버전으로 막는다.
- **구분:** 모든 Run에 `mode`(`REAL` 또는 `DEMO`)가 있다. 실제 설정이 없을 때 데모로 몰래 바꾸지 않고 오류를 돌려준다.
- **서버가 기준:** 화면은 서버가 준 상태만 보여 준다. 애니메이션이나 타이머가 상태를 바꾸지 않는다.

**목차**

- [1. 공통 규칙](#1-공통-규칙)
- [2. 오류](#2-오류)
- [3. 프로젝트 (REQ-001)](#3-프로젝트-req-001)
- [4. 실행 Run (REQ-006, 012, 013, 014)](#4-실행-run-req-006-012-013-014)
- [5. CEO 결정 (REQ-003)](#5-ceo-결정-req-003)
- [6. 이벤트와 SSE](#6-이벤트와-sse)
- [7. 사무실 화면 (REQ-010, 016)](#7-사무실-화면-req-010-016)
- [8. 가상 회사 (REQ-015)](#8-가상-회사-req-015)
- [9. 공통 설정 (REQ-002)](#9-공통-설정-req-002)
- [10. 결과와 검증 (REQ-008, 009, 011, 012)](#10-결과와-검증-req-008-009-011-012)
- [11. 시스템](#11-시스템)
- [12. 요구사항 대응](#12-요구사항-대응)
- [13. 열린 항목](#13-열린-항목)
- [14. 구현 현황](#14-구현-현황)
- [15. 데모 워커](#15-데모-워커)

## 1. 공통 규칙

| 항목      | 규칙                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------- |
| 기본 경로 | `/api`. 버전 접두사는 쓰지 않고, 호환되지 않는 변경은 이 문서의 변경 이력에 남긴다                   |
| 형식      | 요청·응답 모두 `application/json; charset=utf-8`. 필드 이름은 camelCase                              |
| 시각      | ISO 8601 UTC 문자열(예: `2026-11-21T06:40:00Z`)                                                      |
| ID        | 서버가 만드는 문자열. 의미를 해석하지 않는다                                                         |
| 인증      | 없음(단일 사용자 작업 공간). 로컬·비공개 환경 전제. 인터넷에 노출하지 않는다                         |
| 출처 검사 | 변경 요청(`POST`, `PUT`, `DELETE`)에 `Origin`이 있고 서버 출처와 다르면 `403 FORBIDDEN_ORIGIN`       |
| 본문 형식 | 변경 요청은 `Content-Type: application/json`이 아니면 `415 UNSUPPORTED_MEDIA_TYPE`                   |
| 목록      | 커서 방식. `?limit=<1~100, 기본 20>&cursor=<이전 응답의 nextCursor>`. 응답은 `{ items, nextCursor }` |
| 캐시      | 상태 조회는 `Cache-Control: no-store`                                                                |

### 1.1 중복 방지

| 요청                     | 방법                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| 프로젝트 생성, 실행 시작 | `Idempotency-Key` 헤더(8~64자). 같은 키와 같은 본문은 처음 응답을 그대로 돌려준다 |
| 같은 키, 다른 본문       | `409 IDEMPOTENCY_KEY_REUSED`                                                      |
| CEO 응답                 | 결정 ID와 제안 버전으로 식별. 같은 응답의 재전송은 같은 결과, 다른 응답은 충돌    |
| 일시정지·재개·재시도     | 현재 상태에서 이미 반영된 요청이면 같은 결과를 돌려준다(멱등)                     |

### 1.2 데모와 실제 실행

- 응답의 `mode`는 `"REAL"` 또는 `"DEMO"`다. 화면은 데모를 항상 표시한다.
- 실제 모드를 요청했는데 필요한 연동이 없으면 `422 INTEGRATION_NOT_CONFIGURED`로 거절한다. 데모로 바꿔 실행하지 않는다.
- 데모 실행의 결과는 `result.completion`에서 "제품 완료"가 될 수 없다(§10).

## 2. 오류

모든 오류 응답은 같은 모양이다.

```ts
type ApiError = {
  error: {
    code: ErrorCode; // 프로그램이 분기하는 값
    message: string; // 사용자에게 보여 줄 수 있는 한글 문장. 내부 정보는 담지 않는다
    retryable: boolean; // 같은 요청을 다시 보내도 되는지
    details?: Record<string, unknown>; // 필드 오류, 최신 제안 버전 등 코드별 추가 정보
  };
};
```

| HTTP | code                         | 뜻                                                               |
| ---- | ---------------------------- | ---------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`          | 입력 형식·길이 오류. `details.fields`에 필드별 이유              |
| 403  | `FORBIDDEN_ORIGIN`           | 허용되지 않은 출처                                               |
| 404  | `NOT_FOUND`                  | 대상이 없거나 이 작업 공간에 속하지 않음                         |
| 409  | `ACTIVE_RUN_EXISTS`          | 다른 Run이 이미 열려 있음(`details.runId`)                       |
| 409  | `IDEMPOTENCY_KEY_REUSED`     | 같은 키에 다른 본문                                              |
| 409  | `PROPOSAL_VERSION_MISMATCH`  | 제안이 갱신됨. `details.latestVersion`                           |
| 409  | `DECISION_ALREADY_ANSWERED`  | 이미 다른 응답이 저장됨                                          |
| 409  | `DECISION_NOT_OPEN`          | 응답을 받을 수 없는 상태(대체됨, 아직 준비 중 등)                |
| 409  | `RUN_PAUSED`                 | 일시정지 중인 Run에는 응답할 수 없음                             |
| 409  | `INVALID_RUN_STATE`          | 현재 상태에서 불가능한 명령(예: 완료된 Run 재시도)               |
| 409  | `STALE_GENERATION`           | 최신 목표가 접수된 뒤 과거 Run을 재시도함                        |
| 410  | `EVENTS_EXPIRED`             | 요청한 순번 이전 이벤트가 보존 범위를 벗어남. 스냅샷을 다시 조회 |
| 415  | `UNSUPPORTED_MEDIA_TYPE`     | JSON이 아님                                                      |
| 422  | `UNSUPPORTED_SCOPE`          | 지원 범위 밖 요구. `details.gaps`에 차이와 대안                  |
| 422  | `INTEGRATION_NOT_CONFIGURED` | 필요한 연동이 미설정                                             |
| 422  | `LIMIT_REACHED`              | 실행 한도 도달. 새 작업을 시작하지 않음                          |
| 500  | `INTERNAL_ERROR`             | 서버 내부 오류. 상세는 서버 로그에만 남김                        |
| 503  | `SERVICE_UNAVAILABLE`        | DB 등 필수 구성 요소 연결 불가                                   |

## 3. 프로젝트 (REQ-001)

```ts
type CeoLevel = "DELEGATE" | "KEY_DECISIONS" | "COLLABORATIVE";

type ProjectSummary = {
  id: string;
  name: string;
  archived: boolean;
  latestRun: { id: string; status: RunStatus; mode: RunMode } | null;
  hasOpenDecision: boolean;
  createdAt: string;
  updatedAt: string;
};

type Project = ProjectSummary & {
  idea: string; // 원본 아이디어
  purpose: string | null; // 선택 입력
  constraints: string | null; // 선택 입력
  ceoLevel: CeoLevel; // 다음 Run의 기본값
  confirmedSpec: { version: number; summary: string } | null; // 확정 요구사항
  hasLiveApp: boolean; // 마지막 정상 배포가 있는지
};
```

| 메서드·경로                        | 설명                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| `GET /api/projects`                | 목록. `?archived=true`로 보관된 프로젝트. 최근 수정순           |
| `POST /api/projects`               | 생성. 본문 아래 참조. `Idempotency-Key` 필요. `201` + `Project` |
| `GET /api/projects/:id`            | 상세                                                            |
| `POST /api/projects/:id/archive`   | 보관 처리. GitHub·DB·Vercel 리소스는 삭제하지 않는다. `204`     |
| `POST /api/projects/:id/unarchive` | 보관 해제. `204`                                                |
| `POST /api/scope-check`            | 지원 범위 사전 확인. 아이디어만 보내고 아무것도 저장하지 않는다 |

```ts
// POST /api/projects 요청
type CreateProjectRequest = {
  name: string; // 1~100자
  idea: string; // 1~4000자
  purpose?: string; // 최대 1000자
  constraints?: string; // 최대 1000자
  ceoLevel: CeoLevel; // 기본값은 화면이 KEY_DECISIONS로 채운다
};

// POST /api/scope-check 응답
type ScopeCheckResult = {
  supported: boolean;
  gaps: { requirement: string; reason: string; alternative: string | null }[];
};
```

생성은 Run을 시작하지 않는다. 프로젝트 저장 후 `POST /api/projects/:id/runs`로 시작한다. 핵심 요구가 지원 범위를 넘으면 `422 UNSUPPORTED_SCOPE`로 차이를 알리고, 사용자 선택 없이 요구를 삭제하지 않는다.

## 4. 실행 Run (REQ-006, 012, 013, 014)

```ts
type RunStatus =
  | "QUEUED" // 접수됨, 워커가 아직 시작하지 않음
  | "RUNNING"
  | "WAITING_CEO" // CEO 응답 대기
  | "PAUSED"
  | "BLOCKED" // 권한·설정·한도 등 조건 부족
  | "FAILED"
  | "SUCCEEDED";
type RunMode = "REAL" | "DEMO";

type BlockedReason =
  | "CONNECTION_MISSING"
  | "PERMISSION_DENIED"
  | "LIMIT_REACHED"
  | "EXTERNAL_RESULT_UNKNOWN" // 외부 작업 결과를 확인 중
  | "WORKER_UNAVAILABLE";

type Run = {
  id: string;
  projectId: string;
  type: "INITIAL" | "REVISION";
  mode: RunMode;
  status: RunStatus;
  stage: { id: string; label: string } | null; // 예: { id: "W05", label: "화면 설계" }
  ceoLevel: CeoLevel; // Run 시작 시 고정
  blockedReason: BlockedReason | null;
  failure: { stage: string; message: string; retryable: boolean } | null;
  pauseRequested: boolean; // 요청은 받았지만 아직 정지 전
  openDecisionIds: string[];
  usage: Usage;
  limits: RunLimits;
  lastSequence: number; // 이 Run의 마지막 이벤트 순번
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

type Usage = {
  modelCalls: number;
  fixAttempts: number;
  activeSeconds: number; // CEO 대기 시간은 제외
  waitingSeconds: number; // CEO 대기 시간
  estimatedCost: { amount: number; currency: string; isEstimate: true } | null;
};
type RunLimits = {
  maxModelCalls: number | null;
  maxFixAttempts: number | null;
  maxActiveSeconds: number | null;
  maxEstimatedCost: number | null; // 값은 별도 결정(DEC-006). null이면 한도 없음이 아니라 미설정
};
```

| 메서드·경로                   | 설명                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/projects/:id/runs` | Run 시작. `Idempotency-Key` 필요. `202` + `Run`(`QUEUED`). 요청 본문 아래 참조                                                            |
| `GET /api/projects/:id/runs`  | 프로젝트의 Run 목록(최신순)                                                                                                               |
| `GET /api/runs/:id`           | Run 상태                                                                                                                                  |
| `POST /api/runs/:id/pause`    | 일시정지 요청. `202` + `Run`(`pauseRequested: true`). 안전한 지점에서 `PAUSED`가 된다. 이미 전송된 외부 요청을 취소했다고 표시하지 않는다 |
| `POST /api/runs/:id/resume`   | 재개. 응답 없는 질문이 있으면 `WAITING_CEO`로, 차단 사유가 남아 있으면 `BLOCKED`로 돌아간다. `202` + `Run`                                |
| `POST /api/runs/:id/retry`    | `FAILED` Run 재시도. 같은 `runId`를 이어간다. 최신 목표가 있으면 `409 STALE_GENERATION`. `202` + `Run`                                    |
| `GET /api/runs/:id/artifacts` | 역할별 산출물 목록                                                                                                                        |
| `GET /api/artifacts/:id`      | 산출물 상세. 텍스트·JSON은 본문 포함, 큰 파일은 다운로드 링크(유효기간 있음)                                                              |
| `GET /api/runs/:id/usage`     | 사용량(`Usage`)과 한도(`RunLimits`)                                                                                                       |

```ts
// POST /api/projects/:id/runs 요청
type StartRunRequest = {
  type: "INITIAL" | "REVISION"; // 최초 생성이면 INITIAL, 배포 뒤 피드백이면 REVISION
  mode: RunMode; // 화면이 현재 설정에 맞게 보낸다
  ceoLevel: CeoLevel;
  feedback?: string; // REVISION일 때 필수, 1~4000자
};
```

- 작업 공간에는 동시에 열린 Run이 하나만 있을 수 있다. 이미 있으면 `409 ACTIVE_RUN_EXISTS`.
- 피드백으로 목표가 바뀌면 같은 프로젝트에 새 `REVISION` Run이 만들어진다. 같은 목표의 재시도는 `retry`다.
- 한도에 이미 도달해 있으면 `422 LIMIT_REACHED`, 필요한 연동이 없으면 `422 INTEGRATION_NOT_CONFIGURED`.
- `status`만으로 실제 완료를 판단하지 않는다. `SUCCEEDED`는 서버가 완료 조건을 확인한 뒤에만 된다(§10).

## 5. CEO 결정 (REQ-003)

```ts
type DecisionStatus =
  "PREPARED" | "OPEN" | "ANSWERED" | "APPLIED" | "SUPERSEDED";
type DecisionKind =
  | "SCOPE_REVIEW" // 공동 설계형의 기능 범위 검토
  | "DESIGN_REVIEW" // 공동 설계형의 화면 방향 검토
  | "INTEGRATED_REVIEW" // 핵심 결정형의 기능·화면 통합안 검토
  | "EXCEPTION"; // 모든 레벨의 예외 결정(범위 초과, 권한, 한도, 파괴적 변경)

type DecisionSummary = {
  id: string;
  runId: string;
  projectId: string;
  kind: DecisionKind;
  status: DecisionStatus;
  proposalVersion: number;
  title: string;
  openedAt: string | null;
};

type Decision = DecisionSummary & {
  summary: string; // 한 줄 요약
  proposal: { heading: string; items: string[] }[]; // 제안 내용(이번에 만들 기능, 화면 등)
  changesFromPrevious: string[]; // 이전 제안 대비 변경점. 첫 제안이면 빈 배열
  options: { id: string; label: string; description: string }[]; // EXCEPTION에서만 사용
  response: {
    choice: "APPROVE" | "REQUEST_CHANGES" | "SELECT_OPTION";
    optionId: string | null;
    comment: string | null;
    answeredAt: string;
  } | null;
  appliedAt: string | null;
};
```

| 메서드·경로                        | 설명                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `GET /api/decisions?status=OPEN`   | 모든 프로젝트의 응답 대기 결정(알림용). `status`, `projectId`로 필터 |
| `GET /api/decisions/:id`           | 제안 전문                                                            |
| `POST /api/decisions/:id/response` | 응답. 본문 아래 참조. `200` + `Decision`(`ANSWERED`)                 |

```ts
// POST /api/decisions/:id/response 요청
type DecisionResponseRequest = {
  proposalVersion: number; // 사용자가 본 제안 버전
  choice: "APPROVE" | "REQUEST_CHANGES" | "SELECT_OPTION";
  optionId?: string; // SELECT_OPTION일 때 필수
  comment?: string; // REQUEST_CHANGES일 때 필수. 최대 4000자
};
```

| 상황                              | 결과                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 처음 응답                         | `200`. 응답 저장과 재개 요청 등록이 함께 처리된다                                                                               |
| 같은 응답 재전송                  | `200`. 같은 결과(중복 적용 없음)                                                                                                |
| 이미 다른 응답이 저장됨           | `409 DECISION_ALREADY_ANSWERED`                                                                                                 |
| 제안이 새 버전으로 바뀜           | `409 PROPOSAL_VERSION_MISMATCH` + `details.latestVersion`. 화면은 입력 의견을 보존한 채 최신 제안을 보여 준다. 자동 재승인 없음 |
| `PREPARED`, `SUPERSEDED` 상태     | `409 DECISION_NOT_OPEN`                                                                                                         |
| 일시정지 중이거나 정지 요청된 Run | `409 RUN_PAUSED`. 응답은 저장되지 않는다                                                                                        |

- 응답이 없으면 결정은 계속 `OPEN`이다. 시간이 지나도 승인으로 바뀌지 않는다.
- `REQUEST_CHANGES` 후 수정된 제안은 새 `proposalVersion`과 새 결정 ID로 다시 열린다.
- 위임형(`DELEGATE`)에서는 CEO 응답용 결정이 만들어지지 않는다. 위임 정책에 따른 확정 근거는 산출물로 남는다.

## 6. 이벤트와 SSE

### 6.1 이벤트 형식

Run의 모든 진행은 순서 있는 이벤트로 기록된다. SSE와 일반 조회가 같은 형식을 쓴다.

```ts
type RunEvent = {
  runId: string;
  sequence: number; // Run 안에서 1부터 증가. 중복 제거와 이어받기에 사용
  type: RunEventType;
  occurredAt: string;
  stage: string | null;
  role: "PM" | "PLANNER" | "DESIGNER" | "DEVELOPER" | null;
  summary: string; // 사용자에게 보여 줄 수 있는 한 줄. 서버가 저장한 실제 결과
  refs: { artifactId?: string; decisionId?: string; meetingId?: string };
  data: Record<string, unknown>; // 타입별 추가 정보(아래 표)
};
```

| type                                    | 의미                  | `data`의 주요 내용                                                   |
| --------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| `run.accepted`                          | Run 접수              | 프로젝트, CEO 레벨, 한도                                             |
| `run.status_changed`                    | 상태 변경             | `from`, `to`, `blockedReason`                                        |
| `step.started`, `step.completed`        | 단계 시작·완료        | 단계 ID, 산출물 요약                                                 |
| `decision.opened`                       | 응답 대기 결정이 열림 | `decisionId`, `proposalVersion`                                      |
| `decision.answered`, `decision.applied` | 응답 접수, 실제 반영  | `decisionId`, `choice`                                               |
| `meeting.started`                       | 회의 시작             | `meetingId`, 주제, 참여 역할                                         |
| `meeting.statement`                     | 발언                  | `meetingId`, `order`, 발언 요약(서버가 저장한 문구)                  |
| `meeting.reaction`                      | 참여자 반응           | `meetingId`, 반응 종류                                               |
| `meeting.ended`                         | 회의 종료             | `meetingId`, 결과(`DECIDED`, `WAITING_CEO`, `FAILED`, `INTERRUPTED`) |
| `verification.recorded`                 | 검증 결과 기록        | 조건별 `PASS`, `FAIL`, `NOT_RUN`, `NOT_APPLICABLE`                   |
| `external_operation.observed`           | 외부 리소스 상태 확인 | 공급자, 확인된 상태                                                  |
| `run.pause_requested`, `run.paused`     | 정지 요청과 실제 정지 | -                                                                    |
| `run.blocked`, `run.failed`             | 차단, 실패            | 원인, 보존된 결과, 필요한 행동, 재개 가능 여부                       |
| `run.succeeded`                         | 완료                  | 앱 URL, 커밋, 검증 요약                                              |

- 회의 이벤트(`meeting.*`)는 실제 작업이나 결정과 연결된 것만 만들어진다. 실제 작업이 없는 회의는 존재하지 않는다.
- 이벤트는 서버가 기록한 사실이다. 화면의 재생·건너뛰기가 이벤트나 상태를 바꾸지 않는다.

### 6.2 Run 스트림 (SSE)

`GET /api/runs/:id/stream` · `Accept: text/event-stream`

```text
retry: 2000

id: 41
event: run-event
data: {"runId":"r1","sequence":41,"type":"meeting.statement", ...}

: ping
```

| 항목        | 규칙                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| 이벤트 이름 | 항상 `run-event`. 종류는 `data.type`으로 구분                                                                     |
| `id`        | `sequence`와 같은 값                                                                                              |
| 이어받기    | 재연결 시 브라우저가 `Last-Event-ID`를 보낸다. `?after=<순번>`으로도 지정할 수 있고, 둘이 다르면 `?after`가 우선  |
| 접속 직후   | 지정한 순번 이후의 이벤트를 먼저 순서대로 보낸 뒤 실시간 전달로 넘어간다                                          |
| 하트비트    | 15초마다 `: ping` 주석 줄. 끊긴 연결과 프록시 타임아웃을 감지한다                                                 |
| 재연결      | `retry: 2000`. 클라이언트는 순번으로 중복 이벤트를 제거한다                                                       |
| 종료        | Run이 `SUCCEEDED`·`FAILED`가 되어도 연결을 끊지 않는다(재시도·수정이 이어질 수 있음). 클라이언트가 닫는다         |
| 오류        | 순번이 보존 범위를 벗어났으면 연결 전에 `410 EVENTS_EXPIRED`. 클라이언트는 스냅샷(§7)을 다시 받고 이어서 접속한다 |

### 6.3 일반 조회

`GET /api/runs/:id/events?after=<순번>&limit=<1~200, 기본 100>`

응답: `{ items: RunEvent[], lastSequence: number }`. 새로고침 직후의 초기 복원, SSE를 쓸 수 없는 환경, 테스트에 쓴다. `after`를 생략하면 처음부터.

### 6.4 작업 공간 스트림 (알림·목록 갱신용)

`GET /api/stream`

모든 프로젝트의 요약 변화만 전달한다. 패널을 닫았거나 다른 프로젝트를 보고 있어도 CEO 응답 알림과 목록 상태를 갱신하기 위한 용도다. 형식은 §6.2와 같고 `event: workspace-event`를 쓴다.

| type                                                       | 내용                            |
| ---------------------------------------------------------- | ------------------------------- |
| `decision.opened`, `decision.answered`, `decision.applied` | `DecisionSummary`와 프로젝트 ID |
| `run.status_changed`                                       | 프로젝트 ID, Run ID, 새 상태    |

이 스트림은 이어받기 대신, 접속 직후 `GET /api/decisions?status=OPEN`과 `GET /api/projects`로 현재 상태를 읽는 것을 기준으로 한다.

## 7. 사무실 화면 (REQ-010, 016)

화면을 열거나 새로고침할 때 한 번의 호출로 상태를 복원하는 집계 조회다.

`GET /api/projects/:id/office-state`

```ts
type RoleId = "PM" | "PLANNER" | "DESIGNER" | "DEVELOPER";

type OfficeState = {
  project: ProjectSummary;
  run: Run | null;
  roles: {
    role: RoleId;
    status: "IDLE" | "WORKING" | "WAITING" | "DONE" | "FAILED";
    currentTask: string | null; // 실제 작업 요약. 서버가 저장한 문구
    latestArtifactId: string | null;
  }[];
  activeMeeting: MeetingSummary | null; // 진행 중이거나 CEO 대기 중인 회의
  openDecisions: DecisionSummary[];
  latestNews: { sequence: number; role: RoleId | null; text: string } | null;
  lastSequence: number; // 이 값 이후의 이벤트를 SSE로 이어받는다
};

type MeetingSummary = {
  id: string;
  runId: string;
  decisionId: string | null;
  topic: string;
  participants: RoleId[]; // 최대 4명
  status: "IN_PROGRESS" | "WAITING_CEO" | "ENDED" | "FAILED" | "INTERRUPTED";
};

type Meeting = MeetingSummary & {
  statements: {
    order: number;
    sequence: number;
    role: RoleId;
    summary: string;
  }[];
  reactions: { sequence: number; role: RoleId; kind: string }[];
  outcome: string | null; // 결정 결과 요약
  startedAt: string;
  endedAt: string | null;
};
```

| 메서드·경로                          | 설명                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `GET /api/projects/:id/office-state` | 위 집계. Run이 없으면 `run: null`, 역할은 모두 `IDLE`            |
| `GET /api/runs/:id/meetings`         | Run의 회의 목록(`{ items: MeetingSummary[], nextCursor: null }`) |
| `GET /api/meetings/:id`              | 회의 상세와 발언 순서                                            |

복원 순서는 ① `office-state` 조회 → ② `lastSequence` 이후를 SSE로 접속입니다. 늦게 들어온 사용자에게 지나간 회의를 처음부터 재생하지 않고, 현재 상태에 맞는 위치나 요약으로 복원할 수 있다.

## 8. 폐기된 꾸미기 API

`/api/company` 및 하위 카탈로그·외형·배치 저장 경로는 제거되었다. REQ-015는 폐기되었으며 대체 저장 API를 제공하지 않는다. 고정 사무실과 회의 상태 조회는 7절을 따른다.

## 9. 공통 설정 (REQ-002)

비밀 키(토큰 등)는 `.env`에만 두며 API로 입력·조회하지 않는다. 설정 화면은 비밀이 아닌 값과 연결 상태만 다룬다.

```ts
type ConnectionStatus =
  | "CONNECTED"
  | "NOT_CONNECTED" // 비밀 키가 .env에 없음
  | "INSUFFICIENT_PERMISSION"
  | "DISCONNECTED"; // 권한이 철회됨

type Provider = "github" | "vercel" | "supabase";

type Connection = {
  provider: Provider;
  status: ConnectionStatus;
  target: string | null; // 사용자·조직·팀 이름
  checkedAt: string | null; // 마지막 실제 확인 시각
  message: string | null; // 필요한 조치
};

type Settings = {
  connections: Connection[];
  repoVisibility: "PRIVATE" | "PUBLIC"; // 새 저장소 기본값. 기본 PRIVATE
  limits: RunLimits;
  updatedAt: string;
};
```

| 메서드·경로                                       | 설명                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/settings`                               | 현재 설정과 연결 상태                                                                   |
| `PUT /api/settings`                               | 저장소 공개 범위, 실행 한도 같은 비밀이 아닌 값 변경. 새 프로젝트에 적용된다            |
| `POST /api/settings/connections/:provider/verify` | 실제 공급자에 권한을 확인하고 `Connection` 갱신. 확인에 실패해도 완료로 표시하지 않는다 |

- 설정 변경은 이후 **새 프로젝트**에 적용된다. 기존 프로젝트는 저장된 외부 리소스를 유지하고, 접근이 사라지면 차단 사유가 표시된다.
- 연결 해제는 새 외부 작업을 막는 것이며 외부 리소스를 삭제하지 않는다.

## 10. 결과와 검증 (REQ-008, 009, 011, 012)

`GET /api/projects/:id/result`

```ts
type Result = {
  completion: {
    build: "PASS" | "FAIL" | "NOT_RUN"; // 빌드 통과
    deployment: "PASS" | "FAIL" | "NOT_RUN"; // 배포 성공
    product: "COMPLETE" | "INCOMPLETE" | "NOT_VERIFIED"; // 제품 완료
    isDemo: boolean; // true이면 product는 COMPLETE가 될 수 없다
  };
  app: { url: string; accessScope: "PUBLIC_NO_LOGIN" } | null;
  repository: {
    url: string;
    visibility: "PRIVATE" | "PUBLIC";
    commitSha: string;
  } | null;
  deployment: { id: string; url: string; commitSha: string } | null;
  database: {
    provider: "supabase";
    status: "READY" | "NOT_NEEDED" | "FAILED" | "UNKNOWN";
  } | null;
  lastGood: { commitSha: string; deploymentId: string; at: string } | null; // 마지막 정상 결과
  latestRunId: string | null;
  remainingConstraints: string[];
};

type VerificationReport = {
  runId: string;
  target: {
    specVersion: number;
    commitSha: string | null;
    deploymentId: string | null;
  };
  items: {
    id: string; // 예: APP-AC-001
    description: string;
    result: "PASS" | "FAIL" | "NOT_RUN" | "NOT_APPLICABLE";
    evidence: string | null; // 증거 요약 또는 산출물 ID
    reason: string | null; // NOT_APPLICABLE이면 근거
  }[];
};
```

| 메서드·경로                      | 설명                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `GET /api/projects/:id/result`   | 앱 URL, 저장소, 커밋, 배포, DB 상태, 마지막 정상 결과 |
| `GET /api/runs/:id/verification` | 요구사항별 검증 결과와 증거                           |

- 빌드 통과, 배포 성공, 제품 완료는 **별도 필드**다. 필수 항목에 `FAIL`이나 `NOT_RUN`이 남아 있으면 `product`는 `COMPLETE`가 아니다.
- 피드백 수정은 별도 API가 아니라 `POST /api/projects/:id/runs`(`type: "REVISION"`)다.
- 수정 Run이 실패해도 `lastGood`은 덮어쓰이지 않는다.

## 11. 시스템

`GET /api/health`

```ts
type Health = {
  web: "OK";
  database: "OK" | "DOWN";
  worker: "OK" | "DOWN" | "UNKNOWN"; // 최근 heartbeat 기준
  checkedAt: string;
};
```

워커가 `DOWN`이면 화면은 "실행이 대기 중인 이유"를 보여 줄 수 있다. 응답에 연결 문자열, 환경변수, 내부 오류 문구를 담지 않는다. DB가 내려가 있으면 `503`과 함께 같은 본문을 돌려준다.

## 12. 요구사항 대응

| REQ         | 관련 API                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| REQ-001     | `POST /projects`, `POST /scope-check`, `GET /projects/:id`                    |
| REQ-002     | `GET/PUT /settings`, `POST /settings/connections/:provider/verify`            |
| REQ-003     | `GET /decisions`, `POST /decisions/:id/response`                              |
| REQ-006     | `POST /projects/:id/runs`, `GET /runs/:id`, `GET /runs/:id/artifacts`         |
| REQ-007~009 | `GET /projects/:id/result`, `external_operation.observed` 이벤트              |
| REQ-010     | `GET /projects/:id/office-state`, Run·Workspace 스트림                        |
| REQ-011     | `GET /runs/:id/verification`, `GET /projects/:id/result`                      |
| REQ-012     | `POST /projects/:id/runs`(`REVISION`), `GET /projects/:id/result`(`lastGood`) |
| REQ-013     | `pause`, `resume`, `retry`, `GET /runs/:id/events`                            |
| REQ-014     | `GET /runs/:id/usage`, `LIMIT_REACHED`                                        |
| REQ-016     | `meeting.*` 이벤트, `GET /runs/:id/meetings`, `GET /meetings/:id`             |

## 13. 열린 항목

- **가상 회사 계약(§8):** 필드 구성은 화면 담당과 협의해 확정한다.
- **한도 수치(DEC-006):** `RunLimits`의 값과 단위. 필드 모양만 정했다.
- **이벤트 보존 기간:** `EVENTS_EXPIRED`의 기준(몇 개, 며칠)을 정해야 한다.
- **산출물 다운로드:** 큰 파일의 링크 유효기간과 형식.
- **새로고침 후 미저장 의견 복원:** 결정 응답 입력 내용을 서버가 임시 저장할지는 화면 담당과 결정한다.
- **구현 후 검증:** 이 문서는 계약 초안이다. 실제 응답이 문서와 맞는지는 계약 테스트로 확인한다.

## 14. 구현 현황

| 구분        | API                                                                                                     | 상태                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 프로젝트    | `GET/POST /projects`, `GET /projects/:id`, `POST /projects/:id/archive`, `POST /projects/:id/unarchive` | **구현됨**                                                                                     |
| 프로젝트    | `POST /scope-check`                                                                                     | **구현됨**(키워드 기반 사전 확인. 알려진 범위 밖 표현만 잡으며 구현 가능 여부를 보증하지 않음) |
| 실행        | `POST /projects/:id/runs`, `GET /projects/:id/runs`, `GET /runs/:id`                                    | **구현됨**(`mode: REAL`은 연동이 없어 `INTEGRATION_NOT_CONFIGURED`로 거절)                     |
| 실행        | `POST /runs/:id/pause`, `resume`, `retry`                                                               | **구현됨**                                                                                     |
| 실행        | `GET /runs/:id/artifacts`, `GET /artifacts/:id`, `GET /runs/:id/usage`                                  | **구현됨**(큰 산출물의 `downloadUrl`은 항상 null. 객체 저장소를 정한 뒤 구현)                  |
| 결정        | `GET /decisions`, `GET /decisions/:id`, `POST /decisions/:id/response`                                  | **구현됨**                                                                                     |
| 이벤트      | `GET /runs/:id/events`, `GET /runs/:id/stream`(SSE), `GET /stream`(작업 공간 스트림)                    | **구현됨**                                                                                     |
| 사무실·회의 | `GET /projects/:id/office-state`, `GET /runs/:id/meetings`, `GET /meetings/:id`                         | **구현됨**                                                                                     |
| 설정        | `GET/PUT /settings`, `POST /settings/connections/:provider/verify`                                      | **구현됨**(연결 확인은 읽기 전용 호출만. 쓰기 권한은 실제 작업 때 확인)                        |
| 결과·검증   | `GET /projects/:id/result`, `GET /runs/:id/verification`                                                | **구현됨**(읽기만. 검증 결과와 배포 기록은 워커가 만든다)                                      |
| 시스템      | `GET /health`                                                                                           | **구현됨**                                                                                     |

구현된 API는 `tests/api.test.ts`와 `tests/api-office.test.ts`가 실제 DB로 검증한다. **데모 워커**(`npm run worker`)가 Run을 진행한다(§15). 워커가 만드는 동작(결정 요청, 회의, 산출물, 이벤트)은 `tests/worker.test.ts`가 API와 함께 끝까지 검증한다. 실제 AI 생성·코드 실행·배포·검증 결과(`verification`)는 워커가 아직 만들지 않는다.

**구현하면서 정한 규칙(위 계약의 세부)**

- `Idempotency-Key`는 `POST /projects`와 `POST /projects/:id/runs`에서 필수다. 응답은 24시간 보관한다.
- 최초 생성(`INITIAL`)은 프로젝트에 Run이 없을 때만, 수정(`REVISION`)은 완료된 Run이 있을 때만 시작할 수 있다. 어기면 `409 INVALID_RUN_STATE`.
- 응답을 저장하면 Run은 `WAITING_CEO`에서 `QUEUED`로 바뀌고, 재개 Job(`resume:<결정 ID>`)과 `decision.answered`·`run.status_changed` 이벤트가 같은 트랜잭션에 남는다.
- **일시정지:** `QUEUED`·`WAITING_CEO`·`BLOCKED`는 바로 `PAUSED`가 된다. `RUNNING`은 `pauseRequested`만 켜고(요청 저장) 워커가 안전한 지점에서 멈춘다. 끝난 Run은 `409 INVALID_RUN_STATE`.
- **재개:** 차단 사유가 남아 있으면 `BLOCKED`, 응답 없는 CEO 질문이 있으면 `WAITING_CEO`, 아니면 `QUEUED`(재개 Job 등록)로 돌아간다. 정지 요청만 있고 아직 `RUNNING`이면 요청을 취소한다.
- **다시 시도:** `FAILED`만 가능하며 같은 `runId`로 `QUEUED`가 된다(복구 Job 등록, 열린 Run 예약을 다시 잡음). 이미 재시도되어 대기 중이면 같은 결과를 돌려주고(멱등), 더 최신 목표가 접수됐으면 `409 STALE_GENERATION`, 다른 Run이 열려 있으면 `409 ACTIVE_RUN_EXISTS`.
- **역할 상태(`office-state`):** 서버가 기록한 마지막 `step.*` 이벤트와 Run 상태에서 계산한다. 완료 이벤트가 마지막이면 `DONE`, 시작만 있으면 Run이 `RUNNING`일 때 `WORKING`, `FAILED`이면 `FAILED`, 그 밖에는 `WAITING`이다. 이벤트가 없으면 `IDLE`.
- **회의 목록·산출물 목록**은 `{ items, nextCursor: null }` 형식이다(페이지 없음).
- **연결 확인:** `.env`에 키가 있어도 확인하기 전에는 `CONNECTED`로 표시하지 않는다. 비밀 키는 요청 헤더로만 보내고 응답·오류·로그에 담지 않는다. 공급자에 닿지 못하면 이전 상태를 바꾸지 않고 `503`을 돌려준다.
- **결과 판단(`result`):** 검증 항목 ID `BUILD`와 `FINAL_URL`은 시스템이 약속한 이름이며 각각 빌드 통과와 배포 성공을 뜻한다. 나머지 항목은 요구사항별(`APP-AC-*`)이다. 데모 실행이거나 `FAIL`·`NOT_RUN`이 남아 있으면 제품 완료가 아니다. 요구사항 항목이 하나도 없어도 완료가 아니다.
- **작업 공간 스트림(`/stream`):** 접속한 뒤의 결정·상태 변화만 보낸다(접속 전 이력은 보내지 않음). 접속한 뒤 새로 생긴 Run은 처음부터 보낸다.
- 실행 한도에 도달했는지 확인(`LIMIT_REACHED`)은 사용량을 기록하는 워커가 생긴 뒤에 구현한다.

## 15. 데모 워커

`npm run worker`로 실행한다. 대기 중인 Job을 가져와 Run을 진행하며, **실제 AI 생성·코드 실행·외부 연동은 하지 않는 데모**다. 모든 산출물에 "데모 산출물" 안내가 들어간다.

| 구분         | 동작                                                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 흐름         | 범위 확인(PM) → 기획(기획자) → (공동 설계형: 기능 범위 검토) → 화면 설계(디자이너) → (핵심 결정형: 통합안 검토 / 공동 설계형: 화면 검토) → 요구사항 확정 → 개발 계획(개발자) → 마무리        |
| CEO 레벨     | 위임형 0회, 핵심 결정형 1회, 공동 설계형 2회 검토. 위임형은 CEO가 답한 것처럼 결정을 만들지 않고 `DELEGATION_RATIONALE` 산출물과 내부 회의를 남긴다                                          |
| 결정         | 제안 저장(`PREPARED`) → 대기 지점 저장 확인 → `OPEN`(Run `WAITING_CEO`) → 응답 → 반영(`APPLIED`). 응답이 없으면 계속 기다린다                                                                |
| 수정 요청    | `REQUEST_CHANGES`면 관련 산출물을 새 revision으로 다시 만들고, 같은 검토를 새 회차(새 결정, `proposalVersion` +1)로 다시 올린다                                                              |
| 회의         | 검토 제안마다 회의를 만들어 발언·반응을 이벤트로 남기고, 결정 대기 중에는 `WAITING_CEO`, 반영하면 종료한다                                                                                   |
| 정지         | 단계 사이에서 정지 요청을 확인해 `PAUSED`로 바꾸고, 대기열의 오래된 Job은 건너뛴다                                                                                                           |
| 재시작       | 체크포인트(PostgreSQL)에서 이어간다. 비정상 종료로 `RUNNING`에 남은 Job은 시작할 때 대기열로 되돌린다                                                                                        |
| 실패         | 원인과 만든 산출물을 남기고 `FAILED`로 끝낸다. 다시 시도하면 같은 `runId`로 체크포인트부터 이어간다                                                                                          |
| 완료         | Run은 `SUCCEEDED`가 되지만 `result.completion.product`는 `NOT_VERIFIED`다. 데모는 제품 완료가 아니다                                                                                         |
| 상태 확인    | 10초마다 heartbeat를 남기며 `GET /health`의 `worker`에 반영된다                                                                                                                              |
| 설정         | `WORKER_DEMO_DELAY_MS`(ms)는 화면에서 진행을 따라갈 수 있도록 발언·단계 사이에 두는 지연이다. **기본값이 없으며 `.env`에 반드시 설정해야 한다**(없거나 잘못된 값이면 워커가 시작하지 않는다) |
| 한 번에 하나 | PostgreSQL advisory lock으로 워커는 하나만 실행된다. 이미 실행 중이면 시작하지 않는다                                                                                                        |

## 변경 이력

| 버전 | 날짜       | 내용      |
| ---- | ---------- | --------- |
| 0.1  | 2026-11-21 | 초안 작성 |

## 2026-11-21 실행 정책 변경

- 신규 실행 요청은 `mode: REAL`만 지원한다. `DEMO`는 `VALIDATION_FAILED`(400)로 거절하며 Run/Job을 만들지 않는다.
- `GET /api/runs/readiness`는 `{ available: boolean, reason: string | null }`을 반환한다. 실제 실행 접수와 동일한 준비 상태를 사용한다. 현재 생성·배포 어댑터 미구현으로 `available: false`다.
- 과거 DEMO Run 조회·결과 표시는 유지한다. 공개 resume/retry는 과거 DEMO에 `INVALID_RUN_STATE`를 반환한다. REAL resume/retry도 실행 준비 상태를 검사한다.
- DB의 DEMO enum과 과거 데이터는 마이그레이션으로 삭제하거나 REAL로 바꾸지 않는다. 기존 시뮬레이터와 테스트용 역사 데이터 생성은 내부 호환 코드로 남아 있으며 사용자용 신규 실행 경로가 아니다.
- 위 정책은 이 문서의 이전 데모 신규 실행 예시보다 우선한다.

## 실행 한도 기본값 상속

설정의 각 한도는 DB 값 → 환경변수 → 코드 기본값 순서로 해석한다. PUT /api/settings에서 null로 저장하면 해당 필드의 DB 덮어쓰기를 해제한다. GET /api/settings와 새 Run의 limits에는 해석된 값이 표시된다. 0은 기본값 상속이 아니라 실행 금지다. 기존 Run의 스냅샷은 변경하지 않는다.

| 환경변수                       | 코드 기본값 |
| ------------------------------ | ----------: |
| DEFAULT_MAX_MODEL_CALLS        |          50 |
| DEFAULT_MAX_FIX_ATTEMPTS       |           3 |
| DEFAULT_MAX_ACTIVE_SECONDS     |        1800 |
| DEFAULT_MAX_ESTIMATED_COST_USD |           5 |

빈 값·음수·숫자가 아닌 값 등 유효하지 않은 환경변수는 코드 기본값을 사용한다. 횟수/시간은 정수, 비용은 소수를 허용한다. 환경변수 변경은 서버 재시작 후 적용한다. 화면 설정 저장값이 있으면 환경변수보다 우선한다.
