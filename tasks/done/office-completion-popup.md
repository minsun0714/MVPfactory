---
title: 산출물 주소 링크와 사무실 실행 완료 팝업
reqs: [REQ-009, REQ-010]
area: ui
owns:
  [
    src/components/office/ArtifactContent.tsx,
    src/components/office/ExecutionResult.tsx,
    src/components/office/OfficeWorkspace.tsx,
    src/components/office/office-model.ts,
    src/hooks/useOfficeWorkspace.ts,
    src/components/ui/external-url.ts,
    src/styles/factory.css,
    tests/artifact-links.test.ts,
    docs/UI_SPEC.md,
  ]
depends_on: []
---

## 목적

배포 주소를 산출물에서 바로 열고, 사무실에서도 완료 결과를 즉시 확인한다. 기존 결과 조회와 대화상자의 접근성을 재사용한다.

## 완료 조건

- [x] AC-009-1: 산출물의 HTTP(S) URL은 안전한 새 창 링크로 표시한다.
- [x] AC-010-2·4: 실제 실행 성공 시 결과 팝업을 자동으로 열고 데모·실패는 성공 팝업을 띄우지 않는다.
- [x] 현재 사무실 방문 중 닫은 Run은 갱신 때 재노출하지 않으며 수동으로 다시 열 수 있다. 다른 대화상자·프로젝트 생성 중에는 기다린다.
- [x] 데스크톱·모바일, 닫기·키보드·갱신, 산출물 링크를 확인한다.

## 검증 방법

타입·관련 ESLint, URL 및 렌더링 테스트, 로컬 브라우저에서 완료 프로젝트·모바일·상태 갱신을 확인한다. 배포나 운영 DB 변경은 하지 않는다.

검증 결과: URL·렌더링 테스트 2개, 타입 검사, 관련 ESLint 통과. 실제 완료 프로젝트의 배포·저장소 링크와 산출물 링크 확인. 1200×863 / 390×844 화면 확인, Escape 닫기와 폴링 후 재노출 없음, 수동 재열기 확인. 브라우저 응답만 모의 처리한 RUNNING→SUCCEEDED 전환에서 팝업이 열리고 FAILED·DEMO에서는 열리지 않음 확인; 원래 응답으로 복구했다. 운영 상태를 변경하거나 새 앱을 배포하지 않았다.

빌드 제한: `npm run build`는 Turbopack CSS 처리기의 로컬 포트 바인딩이 `Operation not permitted`로 차단되어 완료하지 못했다. 권한 확장 재시도에서도 같은 오류였다. 개발 서버의 실제 화면과 타입·lint·관련 테스트 검증은 통과했다.

후속 조정: 프로젝트 선택·최초 조회·새로고침에서는 자동 팝업을 열지 않는다. 선택한 프로젝트의 같은 Run을 관찰하다 SUCCEEDED로 전환될 때만 자동으로 연다. 브라우저 응답 모의 검증: 최초 진입 0개, 완료 전환 1개, 새로고침 0개, 수동 열기 1개. 타입·관련 ESLint 통과.
