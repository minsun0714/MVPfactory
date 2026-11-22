import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LlmError } from "@/application/llm";
import {
  LimitReachedError,
  createMeteredModel,
  readTokenPrice,
} from "@/application/metered-model";
import type { RunLimits, Usage } from "@/contracts/runs";
import { EMPTY_USAGE } from "@/domain/limits";
import { scriptedModel } from "@tests/helpers/scripted-model";

const NO_LIMITS: RunLimits = {
  maxModelCalls: null,
  maxFixAttempts: null,
  maxActiveSeconds: null,
  maxEstimatedCost: null,
};

function fakeStore(limits: RunLimits, usage: Usage = EMPTY_USAGE) {
  const recorded: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  }[] = [];
  return {
    recorded,
    store: {
      loadUsage: async () => ({
        limits,
        usage: { ...usage, modelCalls: usage.modelCalls + recorded.length },
      }),
      recordModelCall: async (_: string, call: (typeof recorded)[number]) =>
        void recorded.push(call),
    },
  };
}

test("호출할 때마다 사용량과 단가로 계산한 비용을 기록한다", async () => {
  const { store, recorded } = fakeStore(NO_LIMITS);
  const model = createMeteredModel({
    model: scriptedModel(() => "{}"),
    store,
    runId: "r",
    price: { inputPerMTok: 2, outputPerMTok: 10 },
  });
  await model.complete({ messages: [] });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].costUsd, (100 * 2 + 50 * 10) / 1_000_000);
});

test("단가를 모르면 비용을 기록하지 않는다(0으로 꾸미지 않는다)", async () => {
  const { store, recorded } = fakeStore(NO_LIMITS);
  await createMeteredModel({
    model: scriptedModel(() => "{}"),
    store,
    runId: "r",
  }).complete({ messages: [] });
  assert.equal(recorded[0].costUsd, null);
});

test("호출 횟수 한도에 도달하면 모델을 부르지 않고 멈춘다", async () => {
  const inner = scriptedModel(() => "{}");
  const { store } = fakeStore({ ...NO_LIMITS, maxModelCalls: 2 });
  const model = createMeteredModel({ model: inner, store, runId: "r" });
  await model.complete({ messages: [] });
  await model.complete({ messages: [] });
  await assert.rejects(
    model.complete({ messages: [] }),
    (e: unknown) =>
      e instanceof LimitReachedError && /모델 호출 횟수/.test(e.message),
  );
  assert.equal(
    inner.calls.length,
    2,
    "한도에 도달한 뒤에는 공급자를 부르지 않는다",
  );
});

test("한도 0은 한 번도 허용하지 않고, 비용 한도는 기록된 비용으로 판단한다", async () => {
  const inner = scriptedModel(() => "{}");
  await assert.rejects(
    createMeteredModel({
      model: inner,
      store: fakeStore({ ...NO_LIMITS, maxModelCalls: 0 }).store,
      runId: "r",
    }).complete({ messages: [] }),
    LimitReachedError,
  );
  const over = fakeStore(
    { ...NO_LIMITS, maxEstimatedCost: 1 },
    {
      ...EMPTY_USAGE,
      estimatedCost: { amount: 1, currency: "USD", isEstimate: true },
    },
  );
  await assert.rejects(
    createMeteredModel({
      model: inner,
      store: over.store,
      runId: "r",
    }).complete({ messages: [] }),
    /예상 비용/,
  );
  assert.equal(inner.calls.length, 0);
});

test("시간 초과는 호출 횟수에 세고, 그 밖의 실패는 세지 않는다", async () => {
  const failing = (kind: "TIMEOUT" | "AUTH") => ({
    model: "m",
    complete: async () => {
      throw new LlmError(kind, "x");
    },
  });
  const a = fakeStore(NO_LIMITS);
  await assert.rejects(
    createMeteredModel({
      model: failing("TIMEOUT"),
      store: a.store,
      runId: "r",
    }).complete({ messages: [] }),
    LlmError,
  );
  assert.deepEqual(a.recorded, [
    { inputTokens: 0, outputTokens: 0, costUsd: null },
  ]);
  const b = fakeStore(NO_LIMITS);
  await assert.rejects(
    createMeteredModel({
      model: failing("AUTH"),
      store: b.store,
      runId: "r",
    }).complete({ messages: [] }),
    LlmError,
  );
  assert.equal(b.recorded.length, 0);
});

test("단가 설정은 둘 다 올바른 숫자일 때만 쓴다", () => {
  assert.deepEqual(
    readTokenPrice({
      LLM_PRICE_INPUT_PER_MTOK: "2.5",
      LLM_PRICE_OUTPUT_PER_MTOK: "10",
    }),
    { inputPerMTok: 2.5, outputPerMTok: 10 },
  );
  for (const env of [
    {},
    { LLM_PRICE_INPUT_PER_MTOK: "2" },
    { LLM_PRICE_INPUT_PER_MTOK: "a", LLM_PRICE_OUTPUT_PER_MTOK: "1" },
    { LLM_PRICE_INPUT_PER_MTOK: "-1", LLM_PRICE_OUTPUT_PER_MTOK: "1" },
  ])
    assert.equal(readTokenPrice(env), null);
});
