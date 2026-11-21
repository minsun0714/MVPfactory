import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRunUseCases } from "@/application/runs";
import type { RunRepository } from "@/application/ports";
import type { Run } from "@/contracts";
import { AppError } from "@/domain/errors";
import { EMPTY_USAGE, reachedLimit } from "@/domain/limits";

const open = {
  maxModelCalls: 10,
  maxFixAttempts: 3,
  maxActiveSeconds: 600,
  maxEstimatedCost: 5,
};

test("한도에 도달한 항목을 알려 주고, 여유가 있으면 null이다", () => {
  assert.equal(reachedLimit(open, EMPTY_USAGE), null);
  assert.equal(reachedLimit(open, { ...EMPTY_USAGE, modelCalls: 9 }), null);
  assert.equal(
    reachedLimit(open, { ...EMPTY_USAGE, modelCalls: 10 }),
    "모델 호출 횟수",
  );
  assert.equal(
    reachedLimit(open, { ...EMPTY_USAGE, fixAttempts: 3 }),
    "자동 수정 횟수",
  );
  assert.equal(
    reachedLimit(open, { ...EMPTY_USAGE, activeSeconds: 600 }),
    "작업 시간",
  );
  assert.equal(
    reachedLimit(open, {
      ...EMPTY_USAGE,
      estimatedCost: { amount: 5.01, currency: "USD", isEstimate: true },
    }),
    "예상 비용",
  );
});

test("CEO를 기다린 시간은 작업 시간 한도에 포함하지 않는다", () => {
  assert.equal(
    reachedLimit(open, { ...EMPTY_USAGE, waitingSeconds: 99999 }),
    null,
  );
});

test("한도 0은 허용하지 않음이고, null(미설정)은 막지 않는다", () => {
  assert.equal(
    reachedLimit({ ...open, maxModelCalls: 0 }, EMPTY_USAGE),
    "모델 호출 횟수",
  );
  assert.equal(
    reachedLimit(
      {
        maxModelCalls: null,
        maxFixAttempts: null,
        maxActiveSeconds: null,
        maxEstimatedCost: null,
      },
      { ...EMPTY_USAGE, modelCalls: 1e6 },
    ),
    null,
  );
});

function service(run: Partial<Run>) {
  const writes: string[] = [];
  const base = {
    id: "r",
    mode: "REAL",
    status: "FAILED",
    limits: open,
    usage: EMPTY_USAGE,
    ...run,
  } as Run;
  const repository = {
    find: async () => base,
    resume: async () => (writes.push("resume"), base),
    retry: async () => (writes.push("retry"), base),
  } as unknown as RunRepository;
  return {
    writes,
    runs: createRunUseCases(repository, {
      isRealModeAvailable: async () => true,
    }),
  };
}

test("한도에 이른 실행은 재개·재시도하지 않고 LIMIT_REACHED로 멈춘다", async () => {
  const { runs, writes } = service({
    usage: { ...EMPTY_USAGE, modelCalls: 10 },
  });
  for (const action of ["resume", "retry"] as const)
    await assert.rejects(
      runs[action]("r"),
      (e: unknown) =>
        e instanceof AppError &&
        e.code === "LIMIT_REACHED" &&
        /모델 호출 횟수/.test(e.message),
    );
  assert.deepEqual(writes, []);
});

test("여유가 있으면 재개·재시도한다", async () => {
  const { runs, writes } = service({
    usage: { ...EMPTY_USAGE, modelCalls: 3 },
  });
  await runs.resume("r");
  await runs.retry("r");
  assert.deepEqual(writes, ["resume", "retry"]);
});
