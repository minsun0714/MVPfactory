---
title: 기본 셀렉트를 공통 픽셀 선택창으로 교체
reqs: [REQ-015]
area: ui
owns:
  [
    src/components/ui/Select.tsx,
    src/hooks/usePixelSelect.ts,
    src/components/ui/Field.tsx,
    src/components/office/OfficeEditors.tsx,
    src/components/office/ProjectOperations.tsx,
    src/components/projects/ProjectManager.tsx,
    src/components/projects/NewProjectFormView.tsx,
    src/styles/factory.css,
    docs/DESIGN_SYSTEM.md,
  ]
depends_on: [frontend-foundation]
---

## 목적

프로젝트·설정·꾸미기·실행 기록의 네이티브 셀렉트 메뉴를 같은 색상과 상호작용의 공통 컴포넌트로 교체한다.

## 완료 조건

- [x] 실제 DOM에 네이티브 select를 렌더링하지 않는다.
- [x] 제어/비제어 값, 비활성 항목과 fieldset, 키보드 탐색·선택·닫기를 지원한다.
- [x] 모달 내부 목록이 잘리지 않고 모바일 폭 안에서 표시된다.

## 검증

타입 검사와 변경 파일 ESLint 통과. 브라우저에서 UI 도감의 End/Enter 선택·Esc 닫기·포커스 유지, 설정 모달의 데스크톱/390px 선택·Tab 이동·Esc 시 모달 유지, 꾸미기의 문자 탐색·fieldset 비활성화 시 닫기를 확인했다. 실제 설정 저장과 외부 API 변경은 수행하지 않았다. 전체 린트에는 동시 작업 중인 docker-sandbox.ts의 기존 unused eslint-disable 경고 1건이 있었다.
