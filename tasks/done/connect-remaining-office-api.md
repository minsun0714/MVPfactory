---
title: 남은 사무실 API를 화면에 연결
reqs: [REQ-001, REQ-007, REQ-015, REQ-016]
area: ui
owns:
  [
    src/components/office/**,
    src/hooks/useProjectOperations.ts,
    src/hooks/useOfficeEditors.ts,
    src/hooks/useOfficeCommand.ts,
    src/hooks/useRunControl.ts,
    src/hooks/useOfficeList.ts,
    src/services/office-commands.ts,
    tests/office-commands.test.ts,
  ]
depends_on: [connect-office-api]
---

## 목적

미연결 API 20개를 프로젝트·설정·꾸미기 화면에 연결한다. 사용자 요청에 따라 기존 공유 브랜치에서 작업한다.

## 완료 조건

- [x] 프로젝트 상세·범위 검사·보관·복원, 실행 시작·제어·이력, 사용량·산출물·회의·검증·결과를 조회하거나 요청할 수 있다.
- [x] 설정·공급자 확인·회사 외형·배치 저장과 서비스 상태 조회를 연결한다.
- [x] 중복 제출과 회사 버전 충돌을 처리하고 실패 초안을 유지한다.
- [x] 기존 주소는 새 화면으로 연결한다.

## 검증

타입·린트, 서비스 테스트 10개, webpack 프로덕션 빌드 통과. 실제 조회 및 브라우저 모의 쓰기 확인. 자세한 경로와 제약은 docs/OFFICE_API_CONNECTION.md에 기록했다.
실제 AI 실행·배포와 메인 사무실의 꾸미기 렌더러는 이 작업의 API 연결 완료와 구분한다.
