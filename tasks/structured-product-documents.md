---
title: 기획·화면 문서 구조화, 팀 검토 반영, 확정본 기준 개발
reqs: [REQ-007]
area: workflow
owns:
  [
    src/domain/product-documents.ts,
    src/domain/product-document-files.ts,
    src/application/document-review.ts,
    src/application/agents.ts,
    src/application/workflow-steps.ts,
    src/application/workflow-ports.ts,
    src/application/code-writer.ts,
    src/application/real-implementation.ts,
    src/infrastructure/codex/codex-writer.ts,
    src/infrastructure/prisma/workflow-store.ts,
    src/contracts/runs.ts,
    src/components/office/ArtifactContent.tsx,
    scripts/verify-codex.ts,
    tests/product-documents.test.ts,
    tests/document-review.test.ts,
    tests/agents.test.ts,
    tests/codex-writer.test.ts,
    tests/real-workflow.test.ts,
    docs/WORKFLOW.md,
    src/infrastructure/generation-guides/**,
    src/server/worker-runtime.ts,
    src/domain/scope.ts,
    resources/generation-guides/**,
    tests/design-guide.test.ts,
    .prettierignore,
  ]
depends_on: [exclude-generated-auth]
---

## 목적

쿠폰 앱 실행에서 기획 문서의 완료 조건(수정·삭제)과 데이터 계획(수정·삭제 불허)이 모순된 채 개발까지 넘어갔다. 문서를 ID로 연결해 결정적으로 검사하고, 팀 검토 결과가 문서 수정으로 이어지며, 개발·자동 수정·배포가 승인된 확정본만 쓰게 한다.

## 완료 조건

- [x] 기능(APP-REQ)·완료 조건(APP-AC)·화면(SCR) ID와 데이터 사용 동작으로 연결을 검사한다. 데이터 계획이 허용하지 않는 동작을 쓰는 기능을 거부한다.
- [x] 화면 설계 뒤(그리고 L3 범위 검토 전) 팀 검토 회의를 열고, 찾은 문제를 담당 역할이 현재 문서를 고쳐 반영한다. 회의 2회 한도, 승인된 기획은 고치지 않고 미해결로 남긴다. 연결 규칙을 맞추지 못하면 개발 전에 실패한다.
- [x] 대표의 수정 요청 시 문서를 새로 쓰지 않고 현재 문서를 고친다.
- [x] 소스 생성·자동 수정·배포가 확정 사양(ProductSpec)만 읽는다. 자동 수정에도 확정 사양을 전달한다.
- [x] 확정 사양에서 docs/PRD.md·DESIGN.md·IMPLEMENTATION.md·VERIFICATION.md를 만들어 Codex 작업 폴더와 생성 앱 소스에 넣고, 개발자가 바꿔도 확정본으로 되돌린다.
- [x] 디자이너가 저장소에 고정한 Impeccable 지침(4.10.0, Apache-2.0, 원본과 동일 파일)으로 브리프와 화면별 주 행동·네 가지 상태를 쓰고, 지침 버전을 산출물과 docs/DESIGN.md에 남긴다. 지침이 없거나 버전이 다르면 워커가 시작하지 않는다.
- [x] 인증 필요 판단은 대표 입력의 원문 인용(인증근거)이 실제 입력에 있을 때만 중단한다. 추측('개인용', '내 기록')으로 선언하면 다시 판단하게 한다. 로그인 없는 앱의 데이터 공개 범위를 허용 동작으로 계산해 기획 문서·PRD·대표 결정 제안에 보인다.
- [ ] APP-AC를 배포된 앱에서 브라우저로 검증한다. (별도 작업. 현재 VERIFICATION.md는 모두 "검증 전")

## 검증 방법

단위 테스트(도메인 규칙·문서 파일·검토 루프·에이전트 형식·Codex 작성기), 모의 모델 + 실제 Docker 샌드박스 + 테스트 DB의 워크플로우 테스트, 전체 `npm test`, 타입·lint·서식 검사.

검증 결과(2026-11-22): 전체 테스트 278개 통과(워크플로우 통합 11개 포함, 모의 모델·테스트 DB). 타입 검사 통과. 실제 OpenAI·Codex로 검토 회의 품질, 문서 개정 정확도, 디자이너의 지침 준수 품질은 확인하지 않았다(미검증). 프로덕션 빌드는 개발 서버가 실행 중이라 실행하지 않았다.
