/**
 * 화면과 서버가 함께 쓰는 공통 계약. 기준 문서: docs/API.md §1
 * 이 폴더(`src/contracts`)에는 타입과 상수만 둔다. React, Prisma, Next.js 등에 의존하지 않는다.
 */

/** ISO 8601 UTC 문자열. 예: `2026-11-21T06:40:00Z` */
export type IsoDateTime = string;

export const ROLE_IDS = ["PM", "PLANNER", "DESIGNER", "DEVELOPER"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export const CEO_LEVELS = [
  "DELEGATE",
  "KEY_DECISIONS",
  "COLLABORATIVE",
] as const;
export type CeoLevel = (typeof CEO_LEVELS)[number];

export const RUN_MODES = ["REAL", "DEMO"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** 목록 응답. 다음 페이지가 없으면 `nextCursor`는 null */
export type Page<T> = { items: T[]; nextCursor: string | null };

/** 목록 요청의 공통 쿼리 */
export type PageQuery = { limit?: number; cursor?: string };
export const PAGE_LIMIT = { default: 20, min: 1, max: 100 } as const;

export const HEADERS = {
  idempotencyKey: "Idempotency-Key",
} as const;
export const IDEMPOTENCY_KEY_LENGTH = { min: 8, max: 64 } as const;

/** 입력 길이 제한. 서버가 검증하고 화면도 같은 값을 `maxLength`로 쓴다 */
export const INPUT_LIMITS = {
  projectName: 100,
  idea: 4000,
  purpose: 1000,
  constraints: 1000,
  feedback: 4000,
  decisionComment: 4000,
} as const;
