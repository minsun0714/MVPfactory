---
title: 생성 앱 로그인·회원가입·OAuth를 지원 범위에서 제외
reqs: [REQ-001, REQ-004, REQ-006, REQ-007]
area: workflow
owns:
  [
    src/domain/scope.ts,
    src/application/agents.ts,
    tests/domain.test.ts,
    tests/agents.test.ts,
    tests/codex-writer.test.ts,
    tests/api.test.ts,
    tests/real-workflow.test.ts,
    AGENTS.md,
    README.md,
    docs/MVP_FACTORY_PRD.md,
    docs/ARCHITECTURE.md,
    docs/WORKFLOW.md,
  ]
depends_on: []
---

## 목적

사용자 결정에 따라 생성 앱 인증을 제외한다. 앞선 회원가입 기본 포함 지침을 대체한다. 비공개 데이터를 공개로 전환하거나 기존 앱의 인증을 삭제하지 않는다.

## 완료 조건

- [x] AC-001 범위 안내: 인증 요구는 범위 밖이며 인증 없이 쓰는 앱은 허용한다.
- [x] AC-007-5: 기획 인증필요 선언을 필수 검사하고 true이면 형식 재시도 없이 개발 전에 중단한다.
- [x] PM·기획·디자인·Codex 생성과 수정 지침 및 범위 문서를 일치시킨다.

## 검증 방법

도메인·에이전트·Codex 테스트, 범위 검사 API, 실제 워커의 인증 필수 계획 중단(모의 모델·테스트 DB), 타입·lint·서식 검사. 모델의 의미 판단 정확도와 실제 생성 앱의 인증 부재는 별도 미검증이다.

검증 결과: 관련 단위 테스트 35개, 범위 API와 워커 중단 테스트 2개 통과. 타입·관련 ESLint·서식 검사 통과. 워커 테스트는 모의 모델과 테스트 전용 DB를 사용했으며 개발자 호출 없이 중단됨을 확인했다. 실제 모델의 분류 정확도와 생성 앱은 미검증이다.

프로덕션 빌드도 통과했다. 기존 상위 폴더 lockfile 무시 경고는 남아 있다.
