---
title: 사무실 렌더러를 PixiJS로 전환
reqs: [REQ-015, REQ-016]
area: ui
owns:
  [
    src/components/office/scene/**,
    src/components/office/PixiOfficeScene.tsx,
    src/hooks/useOfficeScene.ts,
    public/assets/office/layers/**,
    scripts/split-office-assets.py,
    tests/office-scene.test.ts,
  ]
depends_on: [connect-remaining-office-api]
---

## 목적

정적 SVG 위 버튼 구조를 개별 캐릭터·가구 객체를 확장할 수 있는 PixiJS 장면으로 전환한다. 기존 아트·React 업무 패널·API 계약은 유지한다.

## 완료 조건

- [x] 배경·가구·캐릭터를 분리하고 PixiJS로 렌더링한다.
- [x] 실제 서버 회의 스냅샷만 표현하며 재생·건너뛰기가 업무 상태를 변경하지 않는다. AC-010-3, AC-016-4.
- [x] 동작 줄이기, 접근 가능한 텍스트·버튼, 캔버스 실패 복구·이탈 시 정리를 제공한다.
- [x] 타입·린트·모델 테스트·브라우저·빌드를 확인한다.

## 검증과 경계

실제 로컬 서버의 장면·캔버스 클릭, 페이지 왕복 후 canvas 1개, 모의 WebGL 상실 후 재시도 확인. 모의 회의 집결·복귀·동작 줄이기 프레임을 캡처했다. 실제 DB 변경 없음. 걷기·방향 전환 스프라이트, 임의 배치 반영과 경로 탐색은 별도 작업이다.

타입·전체 린트·모델 및 API 테스트 14개·webpack 프로덕션 빌드 통과. 모션 리뷰로 이름표 가독성을 보완했다. 실제 GPU 프레임 성능은 미측정이다.
