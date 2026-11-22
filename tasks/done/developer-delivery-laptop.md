---
title: 개발자 오른쪽 모니터를 휴대용 노트북으로 교체
reqs: [REQ-009, REQ-010, REQ-016]
area: ui
owns:
  [
    public/assets/office/room.svg,
    public/assets/office/layers/developer-desk.svg,
    public/assets/office/layers/developer-laptop.svg,
    public/assets/office/layers/bounds.json,
    scripts/split-office-assets.py,
    src/components/office/scene/assets.ts,
    src/components/office/scene/motion.ts,
    src/components/office/scene/renderer.ts,
    src/components/office/scene/pixel-actor.ts,
    src/components/office/DeveloperDelivery.tsx,
    src/styles/factory.css,
    tests/office-motion.test.ts,
    docs/UI_SPEC.md,
    docs/ANIMATION_SPEC.md,
  ]
depends_on: []
---

## 목적

개발자 책상의 오른쪽 모니터를 노트북으로 교체하고, 완료 피켓 대신 그 노트북을 들고 나와 결과를 보여준다. 기존 배포 링크·수정 요청 hook과 API 계약은 유지한다.

## 완료 조건

- [x] AC-016: 모니터 두 대를 유지하고 오른쪽 노트북은 분리된 레이어로 관리한다. 기본 SVG와 분리 스크립트도 일치시킨다.
- [x] AC-010-1·3: 집어 든 노트북은 책상에서 사라지고 캐릭터가 이동·대기·복귀 중 소지하며, 책상에 놓을 때 다시 표시한다.
- [x] AC-009-1: 노트북 화면 안에 앱 열기·수정 요청 버튼을 제공하고 기존 폼·모바일·키보드 동작을 유지한다.

## 검증 방법

소품 상태·이동 테스트, 타입·관련 ESLint, 실제 로컬 화면의 작업 중/완료 상태·수정 폼·모바일 확인. 운영 실행을 추가로 시작하지 않는다.

검증 결과: 관련 테스트 12개, 타입·관련 ESLint 통과. 책상에 모니터 두 대와 노트북 한 대 표시, 완료 상태에서 책상 노트북 숨김·캐릭터 소지, 노트북 화면 내부 두 버튼과 수정 입력을 브라우저로 확인했다. 1200×863 / 390×844와 동작 줄이기에서 가로 넘침 없음. 소지·복귀·회의 경유 상태는 단위 테스트로 검증했다. 임시 폴더에서 분리 스크립트를 실행해 개발자 책상·노트북 레이어가 동일하게 재생성됨을 확인했다. 운영 실행·배포는 변경하지 않았다.

프로덕션 빌드는 직전 작업에서 확인된 Turbopack 포트 바인딩 제한 때문에 이번에는 반복하지 않았으며 빌드 통과로 보고하지 않는다.
