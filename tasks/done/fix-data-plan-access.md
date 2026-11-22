---
title: 기획 데이터 접근 계획의 형식 오류와 지원 한계 구분
reqs: [REQ-004, REQ-007]
area: workflow
owns:
  [
    src/domain/data-plan.ts,
    src/application/agents.ts,
    tests/data-plan.test.ts,
    tests/agents.test.ts,
  ]
depends_on: []
---

## 목적

cola_tasted 접근 계획 실패 사례에 맞춰 기획자에게 실제 허용되는 키와 boolean,
공개 read/insert 조건을 명시한다. 잘못된 입력을 조용히 false로 바꾸지 않고
정확한 수정 사유를 제공한다. 공개 권한을 모두 false로 지정한 계획은
형식 재시도 없이 인증 정책 미지원으로 알리며 권한을 넓히지 않는다.

## 완료 조건

- 잘못된 권한 키·값의 복구와 누락된 동작의 기본 거부를 검증한다.
- 명시적 비공개 계획에 대해 공개 접근을 유도하는 모델 재호출을 하지 않는다.
- 기존 RLS·권한 확대 금지·데이터 보존 검증을 유지한다(AC-007-5,6).

## 검증

에이전트·데이터 계획 테스트, 타입 검사·lint·빌드.
실패 당시 모델 응답 원문은 확보되지 않아 잘못된 키/값인지 명시적 거부인지는 미확정.
실제 모델 재호출이나 Supabase 변경은 수행하지 않는다.

검증 결과: 에이전트 12개·데이터 계획 및 로컬 PostgreSQL 6개 테스트 통과. 타입 검사·변경 파일 lint·프로덕션 빌드·서식 검사 통과. 실제 모델 재실행 미검증.
