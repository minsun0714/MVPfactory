---
title: 사용하지 않는 페이지와 전용 코드 제거
reqs: [REQ-001]
area: ui
owns: [src/app/layout.tsx, src/app/office/page.tsx, src/components/projects/ProjectExecutionPage.tsx]
depends_on: []
---

## 변경

프로젝트 목록·이전 생성 경로·사무실 미리보기·UI 도감 페이지와 전용 컴포넌트·훅 삭제. 상세·기록 페이지는 유지하고 목록 복귀 링크를 사무실로 정리. 루트의 숨겨진 구형 헤더·데모 안내 제거.

## 검증

브라우저에서 사무실 200, 삭제한 네 페이지 404 확인. 제거한 경로로 향하는 소스 링크가 없음을 검색으로 확인.
