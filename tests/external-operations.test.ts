import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  OperationConflictError,
  OperationInFlightError,
  OutcomeUnknownError,
  runExternalOperation,
  type OperationSpec,
} from "@/application/external-operations";
import { db, WORKSPACE_ID } from "@/lib/db";
import { createExternalOperationStore } from "@/infrastructure/prisma/external-operation-store";
import { hashRequest } from "@/infrastructure/prisma/idempotency";

const store = createExternalOperationStore(db);
let projectId = "";

before(async () => {
  await db.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID },
    update: {},
  });
  projectId = (
    await db.project.create({
      data: {
        workspaceId: WORKSPACE_ID,
        name: "원장",
        idea: "x",
        ceoLevel: "DELEGATE",
      },
    })
  ).id;
});
after(() => db.$disconnect());

/** 호출 횟수를 세는 가짜 공급자. 실제 외부 서비스를 호출하지 않는다. */
function fakeProvider(
  options: {
    executeFails?: "unknown" | "definite";
    existing?: string | null;
    reconcileFails?: boolean;
  } = {},
) {
  const calls = { execute: 0, reconcile: 0 };
  const state = {
    existing: options.existing ?? null,
    executeFails: options.executeFails,
  };
  const spec = (
    key: string,
    over: Partial<OperationSpec> = {},
  ): OperationSpec => ({
    operationKey: key,
    projectId,
    runId: null,
    provider: "github",
    kind: "CREATE_REPOSITORY",
    targetAccount: "octocat",
    requestHash: hashRequest({ name: "repo" }),
    async execute() {
      calls.execute += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (state.executeFails === "unknown") {
        // 요청은 반영됐지만 응답을 받지 못한 상황
        state.existing = "repo-123";
        throw new OutcomeUnknownError();
      }
      if (state.executeFails === "definite")
        throw new Error("저장소 이름이 이미 있습니다.");
      state.existing = "repo-123";
      return {
        externalId: "repo-123",
        evidence: { url: "https://example.invalid/repo" },
      };
    },
    async reconcile() {
      calls.reconcile += 1;
      if (options.reconcileFails) throw new Error("조회 실패");
      return state.existing
        ? { found: true, externalId: state.existing }
        : { found: false };
    },
    ...over,
  });
  return { calls, state, spec };
}
const entryOf = (key: string) =>
  db.externalOperation.findUniqueOrThrow({ where: { operationKey: key } });
const newKey = () => `test:${randomUUID()}`;

describe("외부 작업 원장", () => {
  test("성공하면 결과를 기록하고, 같은 작업을 다시 요청해도 외부 호출을 하지 않는다", async () => {
    const provider = fakeProvider();
    const key = newKey();
    const first = await runExternalOperation(store, provider.spec(key));
    assert.deepEqual(first, { externalId: "repo-123", reused: false });
    const row = await entryOf(key);
    assert.equal(row.status, "SUCCEEDED");
    assert.equal(row.externalId, "repo-123");
    assert.equal(row.attempt, 1);
    assert.ok(row.observedAt);

    const again = await runExternalOperation(store, provider.spec(key));
    assert.deepEqual(again, { externalId: "repo-123", reused: true });
    assert.equal(provider.calls.execute, 1);
  });

  test("같은 키에 다른 대상이나 요청이 오면 충돌로 거절하고 외부 호출을 하지 않는다", async () => {
    const provider = fakeProvider();
    const key = newKey();
    await runExternalOperation(store, provider.spec(key));
    await assert.rejects(
      runExternalOperation(
        store,
        provider.spec(key, { targetAccount: "다른-계정" }),
      ),
      OperationConflictError,
    );
    await assert.rejects(
      runExternalOperation(
        store,
        provider.spec(key, {
          requestHash: hashRequest({ name: "다른-저장소" }),
        }),
      ),
      OperationConflictError,
    );
    assert.equal(provider.calls.execute, 1);
    assert.equal(
      (await entryOf(key)).targetAccount,
      "octocat",
      "최초 대상은 바뀌지 않는다",
    );
  });

  test("응답을 받지 못하면 UNKNOWN으로 남기고, 다시 요청하기 전에 조회해서 있으면 새로 만들지 않는다", async () => {
    const provider = fakeProvider({ executeFails: "unknown" });
    const key = newKey();
    await assert.rejects(
      runExternalOperation(store, provider.spec(key)),
      OutcomeUnknownError,
    );
    assert.equal((await entryOf(key)).status, "UNKNOWN");
    assert.equal(provider.calls.execute, 1);

    const recovered = await runExternalOperation(store, provider.spec(key));
    assert.deepEqual(recovered, { externalId: "repo-123", reused: true });
    assert.equal(
      provider.calls.execute,
      1,
      "조회로 확인되었으니 다시 만들지 않는다",
    );
    assert.equal((await entryOf(key)).status, "SUCCEEDED");
  });

  test("조회로 없음이 확인될 때만 다시 요청하고, 조회가 실패하면 멈춘다", async () => {
    const key = newKey();
    const provider = fakeProvider({ executeFails: "unknown" });
    await assert.rejects(
      runExternalOperation(store, provider.spec(key)),
      OutcomeUnknownError,
    );
    provider.state.existing = null; // 실제로는 반영되지 않았다는 것이 조회로 확인되는 상황
    provider.state.executeFails = undefined;
    const retried = await runExternalOperation(store, provider.spec(key));
    assert.equal(retried.reused, false);
    assert.equal(provider.calls.execute, 2);
    assert.equal((await entryOf(key)).attempt, 2);

    const blockedKey = newKey();
    const blocked = fakeProvider({
      executeFails: "unknown",
      reconcileFails: true,
    });
    await assert.rejects(
      runExternalOperation(store, blocked.spec(blockedKey)),
      OutcomeUnknownError,
    );
    blocked.state.executeFails = undefined;
    await assert.rejects(
      runExternalOperation(store, blocked.spec(blockedKey)),
      /조회 실패/,
    );
    assert.equal(
      blocked.calls.execute,
      1,
      "상태를 확인하지 못하면 새로 만들지 않는다",
    );
    assert.equal((await entryOf(blockedKey)).status, "UNKNOWN");
  });

  test("확정된 실패는 FAILED로 기록하되 부작용이 남았을 수 있어 재시도 전에 조회한다", async () => {
    const provider = fakeProvider({ executeFails: "definite" });
    const key = newKey();
    await assert.rejects(
      runExternalOperation(store, provider.spec(key)),
      /이미 있습니다/,
    );
    const failed = await entryOf(key);
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(failed.evidence, {
      message: "저장소 이름이 이미 있습니다.",
    });

    provider.state.executeFails = undefined;
    const retried = await runExternalOperation(store, provider.spec(key));
    assert.equal(retried.reused, false);
    assert.equal(provider.calls.reconcile, 1, "다시 요청하기 전에 조회했다");
    assert.equal((await entryOf(key)).status, "SUCCEEDED");
  });

  test("같은 작업을 동시에 요청해도 외부 호출은 한 번만 일어난다", async () => {
    const provider = fakeProvider();
    const key = newKey();
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() => runExternalOperation(store, provider.spec(key))),
    );
    assert.equal(provider.calls.execute, 1);
    assert.equal(
      results.filter((r) => r.status === "fulfilled").length >= 1,
      true,
    );
    for (const result of results)
      if (result.status === "rejected")
        assert.ok(result.reason instanceof OperationInFlightError);
    assert.equal((await entryOf(key)).status, "SUCCEEDED");
    assert.equal((await entryOf(key)).attempt, 1);
  });

  test("요청 중으로 남은 작업은 새로 시작하지 않고, 오래되면 결과 불명확로 돌린 뒤 조회한다", async () => {
    const provider = fakeProvider();
    const key = newKey();
    // 워커가 요청을 보낸 직후 종료된 상태를 만든다.
    await store.begin({ ...provider.spec(key) });
    await db.externalOperation.update({
      where: { operationKey: key },
      data: { status: "REQUESTED", attempt: 1 },
    });
    await assert.rejects(
      runExternalOperation(store, provider.spec(key)),
      OperationInFlightError,
    );
    assert.equal(provider.calls.execute, 0);

    // 아직 최근이면 건드리지 않고, 오래되면 UNKNOWN으로 돌린다.
    assert.equal(await store.markInterruptedUnknown(60_000), 0);
    await db.$executeRaw`UPDATE "ExternalOperation" SET "updatedAt" = now() - interval '10 minutes' WHERE "operationKey" = ${key}`;
    assert.equal(await store.markInterruptedUnknown(60_000), 1);
    assert.equal((await entryOf(key)).status, "UNKNOWN");

    provider.state.existing = "repo-from-before-crash";
    const recovered = await runExternalOperation(store, provider.spec(key));
    assert.deepEqual(recovered, {
      externalId: "repo-from-before-crash",
      reused: true,
    });
    assert.equal(
      provider.calls.execute,
      0,
      "이미 반영된 것을 다시 만들지 않는다",
    );
  });
});
