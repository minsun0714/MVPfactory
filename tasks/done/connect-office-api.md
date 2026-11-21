---
title: 사무실 프론트에 프로젝트·상태·결정 API 연결
reqs: [REQ-001, REQ-003, REQ-010]
area: ui
owns:
  [
    src/services/office-api.ts,
    src/hooks/useOfficeWorkspace.ts,
    src/hooks/useOfficeResource.ts,
    src/hooks/useDecisionReview.ts,
    src/components/office/OfficeWorkspace.tsx,
    src/components/office/OfficeApiPanels.tsx,
    src/app/office/page.tsx,
    src/app/office/preview/**,
    src/styles/factory.css,
    tests/office-api.test.ts,
    docs/OFFICE_API_CONNECTION.md,
  ]
depends_on: []
---

## 목적

현재 브랜치에서 서버 구현을 변경하지 않고 최신 API 계약을 프론트에 연결한다. 기존 API 없는 시안은 `/office/preview`에 유지한다.

## 완료 조건

- [x] 프로젝트 목록·선택·생성, 실제 사무실 상태와 대기 결정 표시. (AC-010-2)
- [x] 버전이 있는 결정 조회와 승인·수정·예외 선택 응답, 중복 제출·충돌 처리. (REQ-003)
- [x] SSE 재연결·조회 실패·빈 상태를 구분하고 데모 표시 유지. (AC-010-3·4)
- [x] 실제 응답/모의 계약 검증을 구분해 기록한다.

## 검증

서비스 계약 테스트, 타입·린트·빌드, 브라우저의 프로젝트 전환·실패·승인·재연결 시나리오. 서버 작업 파일과 DB 데이터는 임의 변경하지 않는다.
