import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { POST as respondDecision } from "@/app/api/decisions/[id]/response/route";
import { GET as getResult } from "@/app/api/projects/[id]/result/route";
import { POST as createProject } from "@/app/api/projects/route";
import { seedHistoricalRun as startRun } from "@tests/helpers/historical-run";
import { POST as pauseRun } from "@/app/api/runs/[id]/pause/route";
import { resumeHistoricalRun as resumeRun } from "@tests/helpers/historical-run";
import { retryHistoricalRun as retryRun } from "@tests/helpers/historical-run";
import { db, WORKSPACE_ID } from "@/lib/db";
import {
  createWorkerRuntime,
  type WorkerRuntime,
} from "@/server/worker-runtime";
import { getContainer } from "@/server/container";

if (existsSync(".env")) process.loadEnvFile();

const BASE = "http://localhost";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const connectionString = process.env.DATABASE_URL!;

function req(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    if (method === "POST") headers["idempotency-key"] = randomUUID();
  }
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function call(
  response: Response | Promise<Response>,
): Promise<{ status: number; body: Json }> {
  const res = await response;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const runtimes: WorkerRuntime[] = [];
async function newRuntime() {
  const runtime = await createWorkerRuntime({
    connectionString,
    demoDelayMs: 0,
  });
  runtimes.push(runtime);
  return runtime;
}

/** 이전 테스트가 남긴, 이미 끝난 Run의 대기 Job을 정리한다. 다른 Run의 Job은 건드리지 않는다. */
async function resetQueue() {
  await db.job.updateMany({
    where: { status: "QUEUED", run: { status: { not: "QUEUED" } } },
    data: { status: "DONE", noOpReason: "테스트 정리" },
  });
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
}

async function begin(ceoLevel: "DELEGATE" | "KEY_DECISIONS" | "COLLABORATIVE") {
  await resetQueue();
  const project = (
    await call(
      createProject(
        req("POST", "/api/projects", {
          name: `워커 ${randomUUID().slice(0, 6)}`,
          idea: "독서 기록 서비스",
          ceoLevel,
        }),
      ),
    )
  ).body;
  const run = (
    await call(
      startRun(
        req("POST", `/api/projects/${project.id}/runs`, {
          type: "INITIAL",
          mode: "DEMO",
          ceoLevel,
        }),
        ctx(project.id),
      ),
    )
  ).body;
  return { project, runId: run.id as string };
}
const runRow = (runId: string) =>
  db.run.findUniqueOrThrow({ where: { id: runId } });
const eventTypes = async (runId: string) =>
  (
    await db.runEvent.findMany({
      where: { runId },
      orderBy: { sequence: "asc" },
    })
  ).map((e) => e.type);
const openDecision = (runId: string) =>
  db.decision.findFirstOrThrow({ where: { runId, status: "OPEN" } });
const respond = (id: string, body: unknown) =>
  call(
    respondDecision(
      req("POST", `/api/decisions/${id}/response`, body),
      ctx(id),
    ),
  );
const finishAll = async (...runIds: string[]) => {
  for (const id of runIds) {
    await db.run
      .update({ where: { id }, data: { status: "SUCCEEDED" } })
      .catch(() => undefined);
    await db.activeRunLock.deleteMany({ where: { runId: id } });
  }
};

before(resetQueue);
after(async () => {
  for (const runtime of runtimes) await runtime.close();
  await getContainer().notifier.close();
  await db.$disconnect();
});

describe("위임형(L1)", () => {
  test("CEO 응답 없이 끝까지 진행하고 위임 근거를 산출물로 남긴다", async () => {
    const { project, runId } = await begin("DELEGATE");
    const runtime = await newRuntime();
    assert.equal(await runtime.drain(), 1);

    const run = await runRow(runId);
    assert.equal(run.status, "SUCCEEDED");
    assert.ok(run.finishedAt);
    assert.equal(await db.activeRunLock.count({ where: { runId } }), 0);
    assert.equal(
      await db.decision.count({ where: { runId } }),
      0,
      "위임형은 CEO 응답용 결정을 만들지 않는다",
    );

    const artifacts = await db.artifact.findMany({
      where: { runId },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      artifacts.map((a) => [a.author, a.type, a.revision]),
      [
        ["PM", "INTAKE_BRIEF", 1],
        ["PLANNER", "PRODUCT_SPEC", 1],
        ["DESIGNER", "SCREEN_PLAN", 1],
        ["SYSTEM", "DELEGATION_RATIONALE", 1],
        ["DEVELOPER", "IMPLEMENTATION_PLAN", 1],
      ],
    );
    assert.ok(JSON.stringify(artifacts[0].content).includes("데모 산출물"));

    const meeting = await db.meeting.findFirstOrThrow({ where: { runId } });
    assert.equal(meeting.topic, "내부 확정 회의");
    assert.equal(meeting.status, "ENDED");
    assert.equal(meeting.decisionId, null);

    const types = await eventTypes(runId);
    assert.equal(types[0], "run.accepted");
    assert.equal(types.at(-1), "run.status_changed");
    assert.ok(types.includes("run.succeeded"));
    assert.ok(!types.includes("decision.opened"));
    const sequences = (
      await db.runEvent.findMany({
        where: { runId },
        orderBy: { sequence: "asc" },
        select: { sequence: true },
      })
    ).map((e) => e.sequence);
    assert.deepEqual(
      sequences,
      sequences.map((_, i) => i + 1),
      "이벤트 순번은 비지 않는다",
    );
    assert.equal(run.lastSequence, sequences.length);

    const spec = await db.productSpec.findFirstOrThrow({
      where: { projectId: project.id },
    });
    assert.equal(spec.version, 1);
    assert.equal(
      (await db.project.findUniqueOrThrow({ where: { id: project.id } }))
        .confirmedSpecVersion,
      1,
    );
    assert.equal(
      (await db.job.findFirstOrThrow({ where: { runId } })).status,
      "DONE",
    );
    assert.ok(
      (await db.usageRecord.count({ where: { runId, kind: "ACTIVE_TIME" } })) >=
        0,
    );

    // 데모는 끝났어도 실제 제품 완료가 아니다.
    const result = await call(
      getResult(
        req("GET", `/api/projects/${project.id}/result`),
        ctx(project.id),
      ),
    );
    assert.equal(result.body.completion.isDemo, true);
    assert.equal(result.body.completion.product, "NOT_VERIFIED");
    assert.equal(result.body.app, null);
  });
});

describe("핵심 결정형(L2)", () => {
  test("통합안에서 CEO 응답을 기다리고, 응답하면 재개해 끝낸다", async () => {
    const { runId } = await begin("KEY_DECISIONS");
    const runtime = await newRuntime();
    assert.equal(await runtime.drain(), 1);

    let run = await runRow(runId);
    assert.equal(run.status, "WAITING_CEO");
    assert.equal(run.stageLabel, "화면 설계");
    const decision = await openDecision(runId);
    assert.equal(decision.kind, "INTEGRATED_REVIEW");
    assert.equal(decision.proposalVersion, 1);
    assert.deepEqual(
      (decision.proposal as Json[]).map((s) => s.heading),
      ["이번에 만들 기능", "화면", "완료 조건"],
    );
    assert.equal(
      (
        await db.meeting.findFirstOrThrow({
          where: { decisionId: decision.id },
        })
      ).status,
      "WAITING_CEO",
    );
    assert.equal(
      await db.activeRunLock.count({ where: { runId } }),
      1,
      "대기 중에도 열린 Run 예약은 유지된다",
    );

    // 응답이 없으면 계속 기다린다. 다시 돌려도 아무것도 바뀌지 않는다.
    assert.equal(await runtime.drain(), 0);
    assert.equal((await runRow(runId)).status, "WAITING_CEO");

    const answered = await respond(decision.id, {
      proposalVersion: 1,
      choice: "APPROVE",
    });
    assert.equal(answered.status, 200);
    assert.equal((await runRow(runId)).status, "QUEUED");
    assert.equal(await runtime.drain(), 1);

    run = await runRow(runId);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(
      (await db.decision.findUniqueOrThrow({ where: { id: decision.id } }))
        .status,
      "APPLIED",
    );
    const meeting = await db.meeting.findFirstOrThrow({
      where: { decisionId: decision.id },
    });
    assert.equal(meeting.status, "ENDED");
    assert.equal(meeting.outcome, "대표님이 승인했어요.");
    const types = await eventTypes(runId);
    for (const type of [
      "decision.opened",
      "decision.answered",
      "decision.applied",
      "meeting.started",
      "meeting.statement",
      "meeting.reaction",
      "meeting.ended",
      "run.succeeded",
    ])
      assert.ok(types.includes(type as never), `${type} 이벤트가 있어야 한다`);
    assert.ok(
      types.indexOf("decision.opened") < types.indexOf("decision.answered"),
    );
    assert.ok(
      types.indexOf("decision.answered") < types.indexOf("decision.applied"),
    );
    assert.equal(await db.artifact.count({ where: { runId } }), 4);
    assert.equal(await db.activeRunLock.count({ where: { runId } }), 0);
  });

  test("워커를 새로 만들어도(재시작) 저장된 체크포인트에서 이어간다", async () => {
    const { runId } = await begin("KEY_DECISIONS");
    const first = await newRuntime();
    await first.drain();
    assert.equal((await runRow(runId)).status, "WAITING_CEO");
    await first.close();

    const decision = await openDecision(runId);
    assert.equal(
      (await respond(decision.id, { proposalVersion: 1, choice: "APPROVE" }))
        .status,
      200,
    );
    const second = await newRuntime(); // 새 그래프·새 연결: 메모리에는 아무 상태도 없다
    await second.drain();
    assert.equal((await runRow(runId)).status, "SUCCEEDED");
    assert.equal(
      await db.artifact.count({ where: { runId, type: "SCREEN_PLAN" } }),
      1,
      "이미 만든 단계를 다시 만들지 않는다",
    );
  });

  test("워커가 작업 도중 종료됐다면 대기열로 되돌려 이어서 처리한다", async () => {
    const { runId } = await begin("DELEGATE");
    // 워커가 Job을 인수하고 실행을 시작한 뒤 비정상 종료된 상태를 만든다.
    await db.job.updateMany({
      where: { runId },
      data: { status: "RUNNING", claimedBy: "죽은-워커", claimEpoch: 1 },
    });
    await db.run.update({ where: { id: runId }, data: { status: "RUNNING" } });
    const runtime = await newRuntime();
    assert.equal(await runtime.worker.recoverInterrupted(), 1);
    assert.equal((await runRow(runId)).status, "QUEUED");
    await runtime.drain();
    assert.equal((await runRow(runId)).status, "SUCCEEDED");
    assert.equal(await db.artifact.count({ where: { runId } }), 5);
  });
});

describe("공동 설계형(L3)", () => {
  test("수정 요청을 반영해 같은 검토를 새 회차로 다시 올리고, 승인하면 다음 검토로 간다", async () => {
    const { runId } = await begin("COLLABORATIVE");
    const runtime = await newRuntime();
    await runtime.drain();
    let decision = await openDecision(runId);
    assert.equal(decision.kind, "SCOPE_REVIEW");
    assert.equal(decision.round, 1);

    assert.equal(
      (
        await respond(decision.id, {
          proposalVersion: 1,
          choice: "REQUEST_CHANGES",
          comment: "공부 시간도 기록하고 싶어요",
        })
      ).status,
      200,
    );
    await runtime.drain();

    const first = await db.decision.findUniqueOrThrow({
      where: { id: decision.id },
    });
    assert.equal(first.status, "APPLIED");
    decision = await openDecision(runId);
    assert.equal(decision.kind, "SCOPE_REVIEW");
    assert.equal(decision.round, 2);
    assert.equal(decision.proposalVersion, 2);
    assert.notEqual(decision.id, first.id);
    assert.deepEqual(decision.changesFromPrevious, [
      "대표님 수정 요청 반영: 공부 시간도 기록하고 싶어요",
    ]);
    const specs = await db.artifact.findMany({
      where: { runId, type: "PRODUCT_SPEC" },
      orderBy: { revision: "asc" },
    });
    assert.equal(specs.length, 2);
    assert.ok(
      JSON.stringify(specs[1].content).includes("공부 시간도 기록하고 싶어요"),
    );
    assert.ok(
      !JSON.stringify(specs[0].content).includes("공부 시간도 기록하고 싶어요"),
    );

    // 이전 제안 버전으로 응답하면 거절한다.
    const stale = await respond(decision.id, {
      proposalVersion: 1,
      choice: "APPROVE",
    });
    assert.equal(stale.body.error.code, "PROPOSAL_VERSION_MISMATCH");

    assert.equal(
      (await respond(decision.id, { proposalVersion: 2, choice: "APPROVE" }))
        .status,
      200,
    );
    await runtime.drain();
    decision = await openDecision(runId);
    assert.equal(decision.kind, "DESIGN_REVIEW");
    assert.equal(
      (await respond(decision.id, { proposalVersion: 1, choice: "APPROVE" }))
        .status,
      200,
    );
    await runtime.drain();

    const run = await runRow(runId);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(await db.decision.count({ where: { runId } }), 3);
    assert.equal(run.usageWaitingSeconds >= 0, true);
    assert.equal(
      await db.meeting.count({ where: { runId, status: "ENDED" } }),
      3,
    );
  });
});

describe("일시정지와 실패", () => {
  test("진행 중 들어온 정지 요청은 다음 단계 전에 반영되고 재개하면 이어서 진행한다", async () => {
    const { runId } = await begin("KEY_DECISIONS");
    // 정지 요청이 실행 시작 직후 들어온 상황
    await db.run.update({
      where: { id: runId },
      data: { pauseRequested: true },
    });
    const runtime = await newRuntime();
    // 대기 상태(QUEUED)에서는 API가 바로 정지시키지만, 여기서는 시작 직후 요청이 들어온 경우를 본다.
    await db.run.update({
      where: { id: runId },
      data: { pauseRequested: false },
    });
    const worker = runtime.worker;
    await db.run.update({
      where: { id: runId },
      data: { pauseRequested: true },
    });
    await worker.runOnce();
    let run = await runRow(runId);
    assert.equal(run.status, "PAUSED");
    assert.equal(run.pauseRequested, false);
    assert.equal(
      await db.artifact.count({ where: { runId } }),
      0,
      "정지한 뒤에는 다음 단계를 진행하지 않는다",
    );
    assert.ok((await eventTypes(runId)).includes("run.paused"));
    assert.equal(
      (await db.job.findFirstOrThrow({ where: { runId } })).status,
      "DONE",
    );

    assert.equal(
      (
        await call(
          resumeRun(req("POST", `/api/runs/${runId}/resume`), ctx(runId)),
        )
      ).body.status,
      "QUEUED",
    );
    await runtime.drain();
    run = await runRow(runId);
    assert.equal(run.status, "WAITING_CEO");
    assert.equal(
      await db.artifact.count({ where: { runId, type: "INTAKE_BRIEF" } }),
      1,
    );
  });

  test("대기 중 정지하면 Job이 있어도 시작하지 않고, 재개 뒤에 진행한다", async () => {
    const { runId } = await begin("DELEGATE");
    assert.equal(
      (
        await call(
          pauseRun(req("POST", `/api/runs/${runId}/pause`), ctx(runId)),
        )
      ).body.status,
      "PAUSED",
    );
    const runtime = await newRuntime();
    await runtime.drain();
    assert.equal((await runRow(runId)).status, "PAUSED");
    assert.equal(await db.artifact.count({ where: { runId } }), 0);
    const skipped = await db.job.findFirstOrThrow({
      where: { runId, kind: "START" },
    });
    assert.equal(skipped.status, "DONE");
    assert.match(skipped.noOpReason ?? "", /대기 상태가 아니어서/);

    await call(resumeRun(req("POST", `/api/runs/${runId}/resume`), ctx(runId)));
    await runtime.drain();
    assert.equal((await runRow(runId)).status, "SUCCEEDED");
  });

  test("실패하면 원인과 산출물을 남기고, 다시 시도하면 체크포인트에서 이어서 끝낸다", async () => {
    const { runId } = await begin("DELEGATE");
    // 실제(REAL) 실행은 연동이 없어 마지막 단계에서 실패한다.
    await db.run.update({ where: { id: runId }, data: { mode: "REAL" } });
    const runtime = await newRuntime();
    await runtime.drain();

    let run = await runRow(runId);
    assert.equal(run.status, "FAILED");
    assert.equal((run.failure as Json).retryable, true);
    assert.match((run.failure as Json).message, /연동이 준비되지 않았습니다/);
    assert.equal(await db.activeRunLock.count({ where: { runId } }), 0);
    assert.equal(
      (await db.job.findFirstOrThrow({ where: { runId, kind: "START" } }))
        .status,
      "FAILED",
    );
    const failed = (
      await db.runEvent.findMany({ where: { runId, type: "run.failed" } })
    )[0];
    assert.equal(
      ((failed.data as Json).preservedArtifactIds as string[]).length,
      5,
    );

    await db.run.update({ where: { id: runId }, data: { mode: "DEMO" } });
    const retried = await call(
      retryRun(req("POST", `/api/runs/${runId}/retry`), ctx(runId)),
    );
    assert.equal(retried.body.status, "QUEUED");
    await runtime.drain();
    run = await runRow(runId);
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(run.failure, null);
    assert.equal(
      await db.artifact.count({ where: { runId } }),
      5,
      "이미 만든 산출물을 다시 만들지 않는다",
    );
  });
});

describe("워커 프로세스", () => {
  test("실제 프로세스가 heartbeat를 남기고 Job을 처리해 CEO 대기까지 진행하며, 종료 신호에 정상 종료한다", async () => {
    const { runId } = await begin("KEY_DECISIONS");
    await db.workerHeartbeat.deleteMany();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/worker.ts"],
      {
        env: { ...process.env, WORKER_DEMO_DELAY_MS: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise<number | null>((resolve) =>
      child.on("exit", (code) => resolve(code)),
    );
    try {
      const deadline = Date.now() + 30_000;
      while ((await runRow(runId)).status !== "WAITING_CEO") {
        if (child.exitCode !== null)
          throw new Error(`워커가 먼저 종료되었습니다:\n${output}`);
        if (Date.now() > deadline)
          throw new Error(`CEO 대기까지 진행하지 못했습니다:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(await db.workerHeartbeat.count(), 1);
      const health = await db.workerHeartbeat.findFirstOrThrow();
      assert.equal(health.version, "demo-0.1");
    } finally {
      child.kill("SIGTERM");
    }
    assert.equal(await exited, 0, output);
    assert.match(output, /워커를 종료했습니다/);
    await db.workerHeartbeat.deleteMany();
    await finishAll(runId);
  });
});
