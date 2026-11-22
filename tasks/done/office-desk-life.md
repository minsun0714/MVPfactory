---
title: 역할별 책상 생활 애니메이션
reqs: [REQ-015, REQ-016]
area: ui
owns:
  [
    src/components/office/scene/desk-life.ts,
    src/components/office/scene/pixel-actor.ts,
    src/components/office/scene/renderer.ts,
    docs/ANIMATION_SPEC.md,
  ]
depends_on: [refine-office-motion]
---

## 목적

정적인 사무실에 PM 차트 관찰·기획자 필기·디자이너 음악 감상·개발자 타이핑을 추가한다. 실제 작업 진행률과 분리된 무음 생활 연출이다.

## 완료 조건

- [x] 역할별 활동·휴식 타이밍, 소품과 모니터 화면을 구분한다.
- [x] AC-010-3: 서버 상태나 이벤트를 생성하지 않고 회의 참가 시 생활 연출을 중지한다.
- [x] AC-016-4: 동작 줄이기는 정적 화면, 비활성 탭·화면 밖은 ticker 정지.

## 검증

타입 검사·변경 파일 ESLint·장면 테스트 12건 통과. 모의 API로 데스크톱·모바일의 대기/회의/복귀를 캡처했고 페이지 오류와 가로 넘침이 없었다. 480ms 간격의 대기 캡처 5장 중 일반 화면은 모두 달랐고, 동작 줄이기는 모두 동일했다. 독립 모션 리뷰에서 표본 내 중대한 문제 없음. 실제 AI 실행·전체 프레임 속도·장시간 GPU 사용량은 검증 범위가 아니다.
