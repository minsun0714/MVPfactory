# 저장소 기여 가이드

## 프로젝트 구조와 모듈 구성

- `src/app/`: Next.js App Router 페이지, API 라우트(새로 작성 예정), 전역 CSS, 파비콘.
- `src/components/`: 화면을 그리는 표현 컴포넌트. `src/hooks/`: 클라이언트 상태와 이벤트 처리. `src/services/`: 클라이언트의 HTTP 요청.
- 서버 쪽은 `src/domain`(업무 규칙), `src/application`(유스케이스와 저장 계약), `src/infrastructure`(Prisma·PostgreSQL 구현), `src/server`(구성과 HTTP 공통 처리)로 나뉘고, `src/app/api`의 Route Handler가 이를 호출한다. 워커는 `src/worker.ts`(진입점), `src/application/worker.ts`·`workflow-steps.ts`(처리 방법), `src/infrastructure/workflow/`(LangGraph)에 있다. `prisma/schema/`에는 새 DB 스키마와 첫 마이그레이션(`prisma/schema/migrations`)이 있고, 화면·서버가 함께 쓰는 API 타입은 `src/contracts/`에 있다. 목표 구조는 [ARCHITECTURE.md](ARCHITECTURE.md) §17을 따른다. `tests/`: 서비스 테스트(서버 재작성 시 워크플로우 테스트 추가).
- `docs/`: 제품·아키텍처 요구사항. `README.md`: 설치 방법과 구현상의 제약. `TASKS.md`와 `tasks/`: 작업 관리 규칙과 작업 파일. `scripts/`: 작업 목록 출력 같은 개발 보조 스크립트.

페이지는 얇게 유지한다. 뷰에는 타입이 있는 데이터와 콜백을 넘기고, 서비스 호출은 표현 컴포넌트 안이 아니라 hook에서 한다.

## 빌드·테스트·개발 명령

Node.js 22, npm, Docker Compose를 사용한다. 지금은 화면 코드만 있으므로 처음 설정할 때는 다음 순서로 실행한다.

```bash
npm ci
cp .env.example .env # .env 파일이 아직 없을 때만 실행
```

DB(`docker compose up -d --wait`)와 Prisma(`npx prisma generate`, `npx prisma migrate deploy`)는 서버 개발을 시작할 때 사용한다. 개발 DB에 삭제한 초기 코드의 옛 테이블이 남아 있으면 `migrate deploy`가 충돌하므로, DB를 초기화하기 전에 확인한다. 스키마는 `prisma/schema/*.prisma` 여러 파일이며, 마이그레이션도 그 폴더 안에 있다.

- `npm run dev`: 로컬 웹 서버를 시작한다.
- `npm run worker`: 데모 워커를 별도로 실행한다. 웹 서버와 별개 프로세스이며 한 번에 하나만 실행된다. 워커가 꺼져 있으면 Run은 `QUEUED`로 남는다.
- `npm run build` / `npm start`: 프로덕션 빌드를 만들고 실행한다.
- `npm run lint`, `npm run typecheck`, `npm run format:check`: 반드시 통과해야 하는 품질 검사.
- `npm run format`: Prettier 서식을 적용한다.
- `npm test`: 전체 테스트를 실행한다. 동작이 바뀌는 변경에서는 테스트와 빌드도 함께 실행한다.

## 코딩 스타일과 이름 규칙

엄격한 TypeScript를 쓰고, Prettier에 맞춰 들여쓰기 2칸, 세미콜론, 큰따옴표, 후행 쉼표를 사용한다. ESLint는 Next.js와 TypeScript 규칙을 따른다. 컴포넌트 파일명은 PascalCase, hook은 `useName.ts`, 함수는 의미가 드러나는 camelCase로 짓는다. `@/*` 경로 별칭은 `src/*`를 가리킨다. 시맨틱 HTML, 입력 라벨, 접근성 있는 오류 표시를 유지한다.

## 테스트 가이드

테스트는 `node:test`와 `node:assert`를 쓰고 `tsx`로 실행한다. 파일 이름은 `tests/*.test.ts`로 짓는다. 별도의 커버리지 수치 기준은 없으며, 변경한 동작과 실패 경로를 검증한다.

워크플로우 테스트는 마이그레이션이 적용된 PostgreSQL이 필요하고 자체 워커를 띄운다. 먼저 다른 워커를 모두 중지한다. 테스트 기록과 체크포인트는 DB에 남는다. 워크플로우를 바꿀 때는 결정 대기, 재시작 후 복구, 중복 응답 처리를 확인한다.

## 커밋과 PR 가이드

기존 커밋은 접두사 없이 내용을 설명하는 한글 제목을 쓴다. 커밋은 한 가지 목적에 집중한다. PR에는 해결하려는 문제, 동작 변화, 검증 결과, 관련 이슈나 REQ/AC 번호, 필요한 설정·마이그레이션을 적는다. 화면이 바뀌면 스크린샷을 첨부한다.

## 설정과 제품 경계

비밀값은 커밋과 로그에 남기지 않는다. 현재 앱은 로컬에서 쓰는 로그인 없는 데모이고, 외부 연동은 자리만 잡아 둔 상태다. 구현된 동작과 PRD의 목표를 구분해서 쓰고, 모의로 만든 생성·배포를 실제 성공으로 보고하지 않는다.

내부 import·재export는 소스와 테스트 모두 `@/` alias를 사용한다. `npm run lint`는 `src`와 `tests`의 상대 경로를 오류로 검사하며 설정·생성 파일은 제외한다.
