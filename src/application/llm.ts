/**
 * 역할 에이전트가 쓰는 언어 모델 호출 계약(Port). 공급자(OpenAI 등)를 모른다.
 * 호출 한도(횟수·비용)는 호출하는 쪽이 `usage`를 누적해 `reachedLimit`로 판단한다.
 */
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmRequest = {
  messages: LlmMessage[];
  /** true면 JSON 객체 하나만 돌려받는다. 응답은 호출자가 스키마로 다시 검증한다. */
  json?: boolean;
  maxOutputTokens?: number;
  /** 이 시간 안에 응답이 없으면 `LlmError("TIMEOUT")` */
  timeoutMs?: number;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmResponse = { text: string; usage: LlmUsage; model: string };

/** 호출자가 처리 방법을 고를 수 있도록 오류를 분류한다. */
export type LlmErrorKind =
  | "AUTH" // 키가 없거나 거부됨 — 재시도해도 소용없음
  | "RATE_LIMIT" // 잠시 후 재시도 가능
  | "TIMEOUT" // 요청이 처리됐는지 알 수 없음(재시도하면 비용이 중복될 수 있음)
  | "REFUSED" // 모델이 응답을 거부하거나 내용이 비었음
  | "INVALID" // 요청이 잘못됨
  | "PROVIDER"; // 공급자 장애

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LanguageModel {
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
