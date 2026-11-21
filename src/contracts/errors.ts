/** 오류 계약. 기준 문서: docs/API.md §2 */
import type { ScopeGap } from "@/contracts/projects";
import type { Company } from "@/contracts/company";

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "FORBIDDEN_ORIGIN",
  "NOT_FOUND",
  "ACTIVE_RUN_EXISTS",
  "IDEMPOTENCY_KEY_REUSED",
  "PROPOSAL_VERSION_MISMATCH",
  "DECISION_ALREADY_ANSWERED",
  "DECISION_NOT_OPEN",
  "RUN_PAUSED",
  "INVALID_RUN_STATE",
  "STALE_GENERATION",
  "VERSION_CONFLICT",
  "EVENTS_EXPIRED",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNSUPPORTED_SCOPE",
  "INTEGRATION_NOT_CONFIGURED",
  "LIMIT_REACHED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 오류 코드별 HTTP 상태 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  ACTIVE_RUN_EXISTS: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  PROPOSAL_VERSION_MISMATCH: 409,
  DECISION_ALREADY_ANSWERED: 409,
  DECISION_NOT_OPEN: 409,
  RUN_PAUSED: 409,
  INVALID_RUN_STATE: 409,
  STALE_GENERATION: 409,
  VERSION_CONFLICT: 409,
  EVENTS_EXPIRED: 410,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSUPPORTED_SCOPE: 422,
  INTEGRATION_NOT_CONFIGURED: 422,
  LIMIT_REACHED: 422,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** 오류 코드별 `details`의 모양. 여기에 없는 코드는 `details`가 없다 */
export interface ApiErrorDetailsMap {
  VALIDATION_FAILED: { fields: { field: string; message: string }[] };
  ACTIVE_RUN_EXISTS: { runId: string };
  PROPOSAL_VERSION_MISMATCH: { latestVersion: number };
  VERSION_CONFLICT: { latest: Company };
  UNSUPPORTED_SCOPE: { gaps: ScopeGap[] };
}

type DetailsOf<C extends ErrorCode> = C extends keyof ApiErrorDetailsMap
  ? { details: ApiErrorDetailsMap[C] }
  : { details?: undefined };

export type ApiError<C extends ErrorCode = ErrorCode> = {
  error: {
    code: C;
    /** 사용자에게 보여 줄 수 있는 한글 문장. 내부 정보는 담지 않는다 */
    message: string;
    /** 같은 요청을 다시 보내도 되는지 */
    retryable: boolean;
  } & DetailsOf<C>;
};
