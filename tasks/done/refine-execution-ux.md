---
title: Impeccable 기준으로 실행 화면의 정보 위계 개선
reqs: [REQ-001, REQ-007]
area: ui
owns:
  [
    src/components/office/ProjectOperations.tsx,
    src/components/office/ExecutionResult.tsx,
    src/components/projects/ProjectExecutionPage.tsx,
    src/hooks/useProjectOperations.ts,
    src/styles/factory.css,
  ]
depends_on: [project-management-page]
---

## 목적

실행 전부터 결과·검사·보관을 동시에 표시하던 화면을 상태별로 정리한다. 픽셀 글꼴·아이보리·월넛 디자인은 유지한다.

## 완료 조건

- [x] 실행 전에는 결과와 내부 상태 코드를 표시하지 않는다.
- [x] 주요 시작 버튼 하나를 강조하고 설정·검사·보관을 펼침 영역에 둔다.
- [x] 진행 중에는 가능한 실행 제어만 표시하고 사용량·산출물·회의·검증은 필요할 때 펼친다.
- [x] 실제 화면과 오류·실행 요청, 반응형·키보드 사용성을 검증한다.

## 검증

실제 로컬 조회·스크린샷 확인. 쓰기는 브라우저 모의 응답으로 검증하고 실제 프로젝트 실행은 하지 않는다.

타입·린트·서비스 테스트 10개 및 webpack 빌드 통과. 실행 전·완료 상태와 390px/1280px 스크린샷 확인. 모의 REAL 요청 실패 후 키 재사용, 설정 딥링크, 완료 후 불필요한 정지 버튼 미노출 확인.
