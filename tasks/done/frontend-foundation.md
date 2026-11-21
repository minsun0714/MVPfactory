---
title: API 독립 픽셀 UI와 사무실 프론트 기반
reqs: [REQ-003, REQ-010, REQ-015]
area: ui
owns:
  [
    src/components/ui/**,
    src/components/office/**,
    src/components/design-system/**,
    src/app/office/**,
    src/app/design-system/**,
    src/styles/factory.css,
    src/hooks/useOfficePreview.ts,
    public/assets/office/**,
    public/fonts/galmuri/**,
    docs/FRONTEND_FOUNDATION.md,
  ]
depends_on: []
---

## 목적

사용자가 확정한 픽셀 디자인 시스템과 API 없는 사무실 미리보기를 구현한다. 사용자 지시에 따라 현재 브랜치에서 API 개발과 동시에 작업하며 서버·계약·공유 설정은 수정하지 않는다.

## 완료 조건

- [x] 공통 컴포넌트의 입력·탭·팝업·알림을 실제 조작할 수 있다.
- [x] 왼쪽 도구 모음과 캐릭터 선택으로 중앙 업무 팝업을 연다. (AC-010-2의 표현 기반)
- [x] API 없는 예시임을 표시하고 생성·저장·승인을 실제 수행했다고 표시하지 않는다. (AC-010-3·4)
- [x] 모바일 업무 보기, 키보드 초점·닫기·복원, reduced-motion을 검증한다. (AC-015-4의 표현 기반)

## 검증 방법

타입·lint·포맷·빌드 검사와 브라우저 데스크톱·모바일 조작 확인. API 응답·서버 저장·실제 실행은 검증 범위가 아니다.
