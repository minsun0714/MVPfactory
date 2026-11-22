/**
 * 모델 호출마다 한도를 확인하고 사용량을 기록하는 `LanguageModel` 감싸개.
 * 에이전트는 이 감싸개를 통해서만 모델을 부르므로 한도를 우회할 수 없다.
 */
import { LlmError, type LanguageModel } from "@/application/llm";
import type { WorkflowStore } from "@/application/workflow-ports";
import { reachedLimit } from "@/domain/limits";

export class LimitReachedError extends Error {
  constructor(readonly label: string) {
    super(
      `${label} 한도에 도달해서 멈췄어요. 한도를 조정한 뒤 이어서 진행할 수 있어요.`,
    );
    this.name = "LimitReachedError";
  }
}

/** 100만 토큰당 가격(USD). 모르면 비용을 기록하지 않는다(0으로 꾸미지 않는다). */
export type TokenPrice = { inputPerMTok: number; outputPerMTok: number };

export function createMeteredModel(deps: {
  model: LanguageModel;
  store: Pick<WorkflowStore, "loadUsage" | "recordModelCall">;
  runId: string;
  price?: TokenPrice | null;
}): LanguageModel {
  const { model, store, runId, price } = deps;
  return {
    model: model.model,
    async complete(request) {
      const { limits, usage } = await store.loadUsage(runId);
      // 자동 수정 횟수는 개발 단계가 따로 판단한다. 모델 호출 자체는 나머지 한도만 본다.
      const reached = reachedLimit({ ...limits, maxFixAttempts: null }, usage);
      if (reached) throw new LimitReachedError(reached);
      try {
        const response = await model.complete(request);
        const costUsd = price
          ? (response.usage.inputTokens * price.inputPerMTok +
              response.usage.outputTokens * price.outputPerMTok) /
            1_000_000
          : null;
        await store.recordModelCall(runId, { ...response.usage, costUsd });
        return response;
      } catch (error) {
        // 시간 초과는 요청이 처리됐을 수 있어 호출 횟수에 센다(비용은 알 수 없다).
        if (error instanceof LlmError && error.kind === "TIMEOUT")
          await store.recordModelCall(runId, {
            inputTokens: 0,
            outputTokens: 0,
            costUsd: null,
          });
        throw error;
      }
    },
  };
}

/** `.env`의 단가 설정. 둘 다 올바른 숫자일 때만 쓴다. */
export function readTokenPrice(
  env: Record<string, string | undefined>,
): TokenPrice | null {
  const input = Number(env.LLM_PRICE_INPUT_PER_MTOK);
  const output = Number(env.LLM_PRICE_OUTPUT_PER_MTOK);
  return env.LLM_PRICE_INPUT_PER_MTOK?.trim() &&
    env.LLM_PRICE_OUTPUT_PER_MTOK?.trim() &&
    Number.isFinite(input) &&
    Number.isFinite(output) &&
    input >= 0 &&
    output >= 0
    ? { inputPerMTok: input, outputPerMTok: output }
    : null;
}
