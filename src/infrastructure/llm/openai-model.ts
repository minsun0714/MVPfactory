/**
 * OpenAI Chat Completions로 만든 `LanguageModel`(DEC-002: OpenAI, 모델은 `LLM_MODEL`).
 * SDK 없이 fetch만 쓴다. 키는 요청 헤더에만 쓰고 오류 메시지·로그에 넣지 않는다.
 */
import {
  LlmError,
  type LanguageModel,
  type LlmRequest,
  type LlmResponse,
} from "@/application/llm";

export type OpenAiOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  defaultTimeoutMs?: number;
};

type ChatBody = {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string };
};

function classify(status: number): LlmError["kind"] {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400 || status === 404 || status === 422) return "INVALID";
  return "PROVIDER";
}

export function createOpenAiModel(options: OpenAiOptions): LanguageModel {
  if (!options.apiKey.trim())
    throw new LlmError("AUTH", "LLM_API_KEY가 비어 있습니다.");
  if (!options.model.trim())
    throw new LlmError("INVALID", "LLM_MODEL이 비어 있습니다.");
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );

  return {
    model: options.model,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        request.timeoutMs ?? options.defaultTimeoutMs ?? 120_000,
      );
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: request.messages,
            ...(request.json
              ? { response_format: { type: "json_object" } }
              : {}),
            ...(request.maxOutputTokens
              ? { max_completion_tokens: request.maxOutputTokens }
              : {}),
          }),
        });
      } catch (error) {
        if (controller.signal.aborted)
          throw new LlmError(
            "TIMEOUT",
            "모델 응답이 시간 안에 오지 않았어요. 요청이 처리됐는지 알 수 없습니다.",
          );
        throw new LlmError(
          "PROVIDER",
          `모델 서버에 연결하지 못했어요: ${error instanceof Error ? error.name : "알 수 없음"}`,
        );
      } finally {
        clearTimeout(timer);
      }

      let body: ChatBody = {};
      try {
        body = (await response.json()) as ChatBody;
      } catch {
        if (response.ok)
          throw new LlmError("PROVIDER", "모델 응답을 읽을 수 없어요.");
      }
      if (!response.ok)
        throw new LlmError(
          classify(response.status),
          `모델 호출 실패(HTTP ${response.status})${body.error?.message ? `: ${body.error.message.slice(0, 200)}` : ""}`,
        );

      const choice = body.choices?.[0];
      if (choice?.message?.refusal)
        throw new LlmError("REFUSED", "모델이 요청을 거부했어요.");
      const text = choice?.message?.content ?? "";
      if (!text.trim())
        throw new LlmError(
          "REFUSED",
          choice?.finish_reason === "length"
            ? "모델 출력이 길이 제한에서 잘려 비었어요."
            : "모델이 빈 응답을 돌려줬어요.",
        );
      return {
        text,
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
        },
        model: body.model ?? options.model,
      };
    },
  };
}
