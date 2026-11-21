import type { ApiErrorDetailsMap, ErrorCode } from "@/contracts/errors";

type DetailsFor<C extends ErrorCode> = C extends keyof ApiErrorDetailsMap
  ? ApiErrorDetailsMap[C]
  : undefined;

/**
 * 호출자가 처리할 수 있는 업무 오류. `code`는 API 계약(docs/API.md §2)의 오류 코드다.
 * `message`는 사용자에게 그대로 보여 줄 수 있는 문장이어야 하며 내부 정보를 담지 않는다.
 */
export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  constructor(
    readonly code: C,
    message: string,
    private readonly extra: {
      retryable?: boolean;
      details?: DetailsFor<C>;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }

  get retryable(): boolean {
    return this.extra.retryable ?? false;
  }

  get details(): DetailsFor<C> | undefined {
    return this.extra.details;
  }
}
