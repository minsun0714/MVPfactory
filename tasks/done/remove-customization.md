---
title: 사용자 꾸미기 기능 제거
reqs: [REQ-015, REQ-016]
area: ui
owns:
  [
    src/components/office/OfficeEditors.tsx,
    src/hooks/useOfficeEditors.ts,
    docs/MVP_FACTORY_PRD.md,
  ]
depends_on: []
---

## 목적

사용자 요청에 따라 REQ-015를 폐기한다. 고정 사무실·캐릭터와 회의·생활 애니메이션은 유지한다.

## 완료 조건

- [x] 꾸미기 메뉴·편집 폼·상태·명령·카탈로그 제거
- [x] 회사 설정 API·도메인·저장소 제거
- [x] 기존 DB 기록은 ignored 스키마로 보존하고 현재 접근 제거
- [x] PRD·아키텍처·API·디자인 문서에 변경 반영

## 검증

관련 테스트 25개, 타입 검사, 변경 코드 ESLint 통과. 브라우저에서 꾸미기 버튼 0개·사무실 canvas 1개·폐기한 API의 404 응답 확인. 실제 설정 변경이나 DB 삭제는 수행하지 않았다.
