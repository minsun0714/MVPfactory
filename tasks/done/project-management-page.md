---
title: 프로젝트 목록 관리를 별도 페이지로 분리
reqs: [REQ-001, REQ-007]
area: ui
owns:
  [
    src/components/projects/ProjectManager.tsx,
    src/components/projects/ProjectExecutionPage.tsx,
    src/hooks/useProjectManager.ts,
    src/app/projects/**,
  ]
depends_on: [connect-remaining-office-api]
---

## 목적

사무실 프로젝트 팝업에 목록·생성·실행·결과가 몰려 있던 문제를 해결한다. 사용자 요청대로 현재 브랜치에서 작업한다.

## 완료 조건

- [x] 프로젝트 목록은 독립 페이지에서 검색·보관·복원하고 12개씩 표시한다.
- [x] 생성 폼은 요청할 때만 팝업으로 연다.
- [x] 실행·결과는 프로젝트 상세로 분리하고 사무실과 왕복한다.
- [x] 이전 프로젝트 팝업 링크를 새 목록 페이지로 연결한다.

## 검증

타입·린트 검사, 브라우저 목록 이동·검색·생성 팝업·상세 이동·모바일 가로 넘침·이전 URL 이동 확인. 실제 DB 쓰기 없이 검증했다.
