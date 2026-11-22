---
title: 코드 작성·수정을 Codex CLI로 분리
reqs: [REQ-006, REQ-014]
area: workflow
owns:
  [
    src/application/code-writer.ts,
    src/infrastructure/codex/**,
    src/server/real-execution.ts,
    src/server/worker-runtime.ts,
    src/application/real-implementation.ts,
    src/application/workflow-steps.ts,
    src/infrastructure/integrations/readiness.ts,
    tests/codex-writer.test.ts,
  ]
depends_on: []
---

## 목적

OpenAI는 회의·PM·기획·설계에 유지하고 코드 작성·수정은 기존 로그인으로
Codex CLI가 앱 폴더에 직접 작성하게 한다. Docker 빌드·테스트와 기존 배포 흐름은 유지한다.

## 완료 조건

- 운영 코드 작성 경로는 Codex이며 API 파일 JSON 생성으로 대체하지 않는다(AC-006-1,4).
- 격리 편집·환경변수 허용 목록·소스 안전 검사·시간 제한을 적용한다.
- CLI 실패와 사용량을 기록하고 기존 수정·실행 한도를 지킨다(AC-006-3).
- 모의 CLI의 정상·실패·복구, 실제 CLI/Docker 연결을 구분해 검증한다(AC-006-2).

## 검증 방법

Codex 어댑터/준비 상태/워크플로우 회귀 테스트, 타입 검사·lint·빌드.
scripts/verify-codex.ts는 별도 명시 실행으로 실제 Codex 사용량이 발생한다.

## 검증 결과

- 전체 회귀 테스트 234개 통과(테스트 DB·실제 Docker, 외부 공급자는 모의 구현).
- 파일 도구와 준비 상태 테스트를 추가한 뒤 관련 테스트 33개 통과.
- 실제 로그인된 Codex CLI 0.171.0이 계산기 소스 7개를 작성하고 Docker에서
  설치·Next.js 빌드·Vitest 테스트 4개 통과. 비밀값 검사도 통과.
- 실제 호출은 팩토리 DB·GitHub·Vercel을 변경하지 않았다. 실제 Codex 수정·전체 게시 흐름은 미검증이며 모의 개발자 기반 수정·게시 회귀 테스트는 통과했다.
- 타입 검사·프로덕션 빌드 통과. Lint 오류 없음(기존 docker-sandbox.ts 경고 1개).
- 기본 apply_patch의 파일 쓰기 실패가 재현되어 작업 폴더 내부만 허용하는
  MCP 파일 도구를 연결했다. 해당 도구 3개만 사전 허용하며 셸 실행은 계속 비활성화한다.
- 기존 실행 중인 워커는 재시작 후 새 구성을 사용한다.
