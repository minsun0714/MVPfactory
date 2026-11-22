---
title: 개발자 완료 피켓과 사무실 수정 요청
reqs: [REQ-009, REQ-010, REQ-012, REQ-016]
area: ui
owns:
  [
    src/hooks/useOfficeWorkspace.ts,
    src/hooks/useOfficeScene.ts,
    src/hooks/useDeliveryRequest.ts,
    src/components/office/OfficeWorkspace.tsx,
    src/components/office/PixiOfficeScene.tsx,
    src/components/office/DeveloperDelivery.tsx,
    src/components/office/office-model.ts,
    src/components/office/scene/model.ts,
    src/components/office/scene/motion.ts,
    src/components/office/scene/renderer.ts,
    src/components/office/scene/pixel-actor.ts,
    src/styles/factory.css,
    tests/office-motion.test.ts,
    docs/UI_SPEC.md,
    docs/ANIMATION_SPEC.md,
  ]
depends_on: []
---

## 목적

완료 결과 팝업을 개발자가 들고 있는 피켓으로 대체한다. 배포 앱을 열고 사무실 안에서 기존 REVISION API로 수정 요청을 보낸다. API·배포·워크플로우 계약은 변경하지 않는다.

## 완료 조건

- [x] AC-010-1·3·4: REAL 성공에서만 개발자가 테이블 옆으로 이동해 서서 피켓을 들며 기존 완료 프로젝트는 즉시 복원한다. 회의·실패·데모를 완료로 연출하지 않는다.
- [x] AC-009-1: 현재 Run에 대응하는 결과 주소만 링크로 표시한다. 읽기 오류·주소 없음·미검증 상태를 안내한다.
- [x] AC-012-1: 수정 폼은 기존 프로젝트와 CEO 레벨로 REVISION을 요청한다. 중복 전송을 막고 같은 요청 재시도는 동일 키를 사용한다. 실패 시 입력을 유지한다.
- [x] AC-016: 이동 경로, 동작 줄이기, 모바일 폼, 키보드 접근, 프로젝트 전환을 확인한다.

## 검증 방법

관련 단위 테스트·타입·ESLint, 로컬 브라우저의 실제 완료 결과 조회와 모바일 확인. 수정 요청의 성공·실패·재시도는 브라우저 응답만 모의 처리하여 운영 수정 실행이나 비용을 발생시키지 않는다.

검증 결과: 관련 테스트 14개, 타입·관련 ESLint 통과. 1200×863 / 390×844 화면과 동작 줄이기 확인. 브라우저에서 실제 완료 결과 링크, 프로젝트 전환 시 다른 앱 주소·빈 새 입력, 결과 조회 실패·재시도, 준비 미완료 제출 차단 확인. 모의 RUNNING→SUCCEEDED에서 약 3.7초 이동 뒤 피켓 표시, 팝업 0개. 모의 수정 요청은 중복 제출 1회만 전송, 실패 후 내용 보존, 재시도 동일 키, REVISION·REAL·기존 CEO 레벨 전송, 새 서버 상태 후 피켓 제거 확인. 모든 모의 라우트를 복구했으며 실제 수정 실행·외부 배포는 하지 않았다.

빌드는 권한 확장 실행에서도 Turbopack CSS 처리기의 로컬 포트 바인딩이 Operation not permitted로 차단되어 미완료다. 코드 오류로 판단하지 않았으며 빌드 통과로 보고하지 않는다.
