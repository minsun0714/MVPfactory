---
title: 사무실 이동·착석·대화 동작 개선
reqs: [REQ-015, REQ-016]
area: ui
owns:
  [
    src/components/office/scene/**,
    src/components/office/PixiOfficeScene.tsx,
    src/hooks/useOfficeScene.ts,
    src/styles/factory.css,
    tests/office-motion.test.ts,
    docs/ANIMATION_SPEC.md,
  ]
depends_on: [pixi-office-renderer]
---

## 목적

앉은 그림이 직선으로 미끄러지는 동작을 방향·관절별 픽셀 캐릭터와 통로 이동으로 교체한다. 회의 발언의 읽기 시간과 몸짓·말풍선 표시를 같은 재생 상태로 연결한다. 사용자 지시에 따라 기존 공유 브랜치에서 프론트 파일만 작업한다.

## 완료 조건

- [x] AC-016-1: 준비·걷기·착석·발언·서버 반응·복귀를 구분한다. 현재 기본 배치에서 원탁을 피해 이동한다.
- [x] AC-016-2, AC-010-3: 실제 회의 스냅샷과 발언만 표현하며 서버 명령을 생성하지 않는다.
- [x] AC-016-3: 종료 시 말풍선 제거·복귀, 중단 시 이동·읽기 시간 정지, 재진입 시 최신 상태 복원.
- [x] AC-016-4: OS 동작 줄이기와 모바일 텍스트를 유지한다. 사용자가 제거한 컨트롤은 재도입하지 않는다.

## 검증

- `npx tsx --test tests/office-motion.test.ts tests/office-scene.test.ts`: 이동 경로·거리 비례 속도·도착 전 발언 보류·중복 제거·일시정지·최신 복원·종료·reduced-motion 검증.
- 타입 검사·ESLint와 변경 파일 Prettier 검사.
- Playwright API 응답 대체로 1360×960 일반/동작 줄이기, 390×844 모바일 소집·발언·복귀 프레임 캡처. 실제 DB·실행·승인 변경 없음.
- 캡처는 시간 간격별 표본이며 전체 FPS 성능 측정이나 실제 LLM 연동 검증은 아니다. 사용자 편집 배치의 범용 경로 탐색은 후속 범위다.
