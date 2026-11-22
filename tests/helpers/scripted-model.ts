import type { LanguageModel, LlmRequest, LlmResponse } from "@/application/llm";

/** 테스트용 모의 모델. 미리 정한 답을 돌려줄 뿐이며 실제 실행 경로에는 쓰지 않는다. */
export type ScriptedModel = LanguageModel & { calls: LlmRequest[] };

export function scriptedModel(
  respond: (request: LlmRequest, index: number) => string,
): ScriptedModel {
  const calls: LlmRequest[] = [];
  return {
    model: "scripted",
    calls,
    async complete(request): Promise<LlmResponse> {
      calls.push(request);
      return {
        text: respond(request, calls.length - 1),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "scripted",
      };
    },
  };
}

export const systemOf = (request: LlmRequest) =>
  request.messages.find((m) => m.role === "system")?.content ?? "";
