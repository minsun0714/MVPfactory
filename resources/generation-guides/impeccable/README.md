# Impeccable 디자인 지침 (생성 앱 디자이너용)

생성 앱의 디자이너 에이전트가 화면 설계를 쓸 때 따르는 지침이다. 팩토리 자체(사무실 UI)의 디자인 규칙이 아니다.

| 항목      | 값                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| 원본      | https://github.com/pbakaus/impeccable                                                          |
| 버전      | 스킬 4.10.0, 태그 `skill-v4.10.0`, 커밋 `b49177d32788f2dc585c42831d845dacf1ebed2c`             |
| 원본 경로 | `.agents/skills/impeccable/SKILL.md`, `.agents/skills/impeccable/reference/{shape,operate}.md` |
| 라이선스  | Apache-2.0 (`LICENSE`, `NOTICE.md`를 원본에서 그대로 복사)                                     |
| 수정      | 없음. 파일은 원본과 같다(2026-11-22 확인).                                                     |

## 사용 방식

- 워커가 시작할 때 `src/infrastructure/generation-guides/impeccable.ts`가 이 폴더를 읽는다. 파일이 없거나 `SKILL.md`의 버전이 고정한 버전과 다르면 워커가 시작하지 않는다.
- 디자이너 프롬프트에는 `SKILL.md`의 앞부분(핵심 원칙)과 "How to design", "Modes", `shape.md`의 브리프 작성 부분, `operate.md` 전체를 넣는다. 스크립트 실행·화면 캡처·사용자 질문처럼 이 환경에서 할 수 없는 지시는 건너뛰게 한다.
- 화면 설계 산출물과 생성 앱의 `docs/DESIGN.md`에 사용한 지침 이름과 버전을 남긴다.

## 버전 올리기

1. 원본의 새 태그에서 같은 경로의 파일과 `LICENSE`, `NOTICE.md`를 가져온다.
2. 위 표와 로더의 고정 버전(`IMPECCABLE_VERSION`)을 함께 바꾼다.
3. 디자이너 관련 테스트를 실행한다.
