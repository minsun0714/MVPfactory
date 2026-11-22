import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { DEFAULT_RUN_LIMITS } from "@/infrastructure/integrations/default-limits";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { after, describe, test } from "node:test";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getMeeting } from "@/app/api/meetings/[id]/route";
import { GET as getOfficeState } from "@/app/api/projects/[id]/office-state/route";
import { POST as createProject } from "@/app/api/projects/route";
import { seedHistoricalRun as startRun } from "@tests/helpers/historical-run";
import { GET as getResult } from "@/app/api/projects/[id]/result/route";
import { GET as listMeetings } from "@/app/api/runs/[id]/meetings/route";
import { GET as getVerification } from "@/app/api/runs/[id]/verification/route";
import {
  GET as getSettings,
  PUT as putSettings,
} from "@/app/api/settings/route";
import { POST as verifyConnection } from "@/app/api/settings/connections/[provider]/verify/route";
import { GET as streamWorkspace } from "@/app/api/stream/route";
import { POST as respondDecision } from "@/app/api/decisions/[id]/response/route";
import { db, WORKSPACE_ID } from "@/lib/db";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { getContainer } from "@/server/container";

if (existsSync(".env")) process.loadEnvFile();

const BASE = "http://localhost";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function req(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (method === "POST" && body !== undefined && !h["idempotency-key"])
    h["idempotency-key"] = randomUUID();
  return new Request(`${BASE}${path}`, {
    method,
    headers: h,
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
async function makeProject() {
  const res = await call(
    createProject(
      req("POST", "/api/projects", {
        name: `사무실 ${randomUUID().slice(0, 6)}`,
        idea: "독서 기록",
        ceoLevel: "KEY_DECISIONS",
      }),
    ),
  );
  assert.equal(res.status, 201);
  return res.body;
}
async function releaseAll() {
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
}
async function newRun() {
  await releaseAll();
  const project = await makeProject();
  const run = (
    await call(
      startRun(
        req("POST", `/api/projects/${project.id}/runs`, {
          type: "INITIAL",
          mode: "DEMO",
          ceoLevel: "KEY_DECISIONS",
        }),
        ctx(project.id),
      ),
    )
  ).body;
  return { project, runId: run.id as string };
}
async function finish(
  runId: string,
  status: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
) {
  await db.run.update({
    where: { id: runId },
    data: { status, finishedAt: new Date() },
  });
  await db.activeRunLock.deleteMany({ where: { runId } });
}
const step = (
  runId: string,
  type: "step.started" | "step.completed",
  role: "PM" | "PLANNER" | "DESIGNER" | "DEVELOPER",
  summary: string,
) =>
  db.$transaction((tx) =>
    appendRunEvent(tx, runId, {
      type,
      role,
      summary,
      data:
        type === "step.started"
          ? { stageId: "W03" }
          : { stageId: "W03", artifactId: null },
    } as never),
  );

after(async () => {
  await getContainer().notifier.close();
  await db.$disconnect();
});

describe("사무실 화면 상태", () => {
  test("실행이 없으면 모든 역할이 대기 상태다", async () => {
    const project = await makeProject();
    const res = await call(
      getOfficeState(
        req("GET", `/api/projects/${project.id}/office-state`),
        ctx(project.id),
      ),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.run, null);
    assert.deepEqual(
      res.body.roles.map((r: Json) => [r.role, r.status]),
      [
        ["PM", "IDLE"],
        ["PLANNER", "IDLE"],
        ["DESIGNER", "IDLE"],
        ["DEVELOPER", "IDLE"],
      ],
    );
    assert.equal(res.body.activeMeeting, null);
    assert.deepEqual(res.body.openDecisions, []);
    assert.equal(res.body.lastSequence, 0);
    assert.equal(
      (
        await call(
          getOfficeState(
            req("GET", "/api/projects/없음/office-state"),
            ctx("없음"),
          ),
        )
      ).status,
      404,
    );
  });

  test("서버가 기록한 이벤트·산출물·결정·회의에서 역할 상태를 계산한다", async () => {
    const { project, runId } = await newRun();
    try {
      await db.run.update({
        where: { id: runId },
        data: { status: "RUNNING" },
      });
      await step(runId, "step.started", "PM", "범위를 정리하는 중");
      await step(runId, "step.completed", "PM", "범위 정리 완료");
      await step(runId, "step.started", "PLANNER", "기능을 정리하는 중");
      const artifact = await db.artifact.create({
        data: {
          runId,
          author: "PM",
          type: "INTAKE_BRIEF",
          title: "요약",
          schemaVersion: 1,
          checksum: "x",
          content: { a: "b" },
        },
      });
      const meeting = await db.meeting.create({
        data: {
          runId,
          topic: "기능 범위 검토",
          participants: ["PM", "PLANNER"],
          startedAt: new Date(),
        },
      });

      let res = await call(
        getOfficeState(
          req("GET", `/api/projects/${project.id}/office-state`),
          ctx(project.id),
        ),
      );
      const roles = Object.fromEntries(
        res.body.roles.map((r: Json) => [r.role, r]),
      );
      assert.equal(roles.PM.status, "DONE");
      assert.equal(roles.PM.latestArtifactId, artifact.id);
      assert.equal(roles.PLANNER.status, "WORKING");
      assert.equal(roles.PLANNER.currentTask, "기능을 정리하는 중");
      assert.equal(roles.DESIGNER.status, "IDLE");
      assert.equal(res.body.activeMeeting.id, meeting.id);
      assert.equal(res.body.activeMeeting.topic, "기능 범위 검토");
      assert.equal(res.body.latestNews.text, "기능을 정리하는 중");
      assert.equal(res.body.latestNews.role, "PLANNER");
      assert.equal(res.body.lastSequence, res.body.run.lastSequence);

      await db.run.update({
        where: { id: runId },
        data: { status: "WAITING_CEO" },
      });
      await db.decision.create({
        data: {
          runId,
          kind: "INTEGRATED_REVIEW",
          status: "OPEN",
          proposalVersion: 1,
          proposalFingerprint: randomUUID(),
          title: "통합안",
          summary: "s",
          proposal: [],
          changesFromPrevious: [],
          options: [],
          openedAt: new Date(),
        },
      });
      res = await call(
        getOfficeState(
          req("GET", `/api/projects/${project.id}/office-state`),
          ctx(project.id),
        ),
      );
      assert.equal(
        res.body.roles.find((r: Json) => r.role === "PLANNER").status,
        "WAITING",
      );
      assert.equal(res.body.openDecisions.length, 1);
      assert.equal(res.body.run.status, "WAITING_CEO");
      assert.equal(res.body.project.hasOpenDecision, true);

      await db.run.update({ where: { id: runId }, data: { status: "FAILED" } });
      res = await call(
        getOfficeState(
          req("GET", `/api/projects/${project.id}/office-state`),
          ctx(project.id),
        ),
      );
      assert.equal(
        res.body.roles.find((r: Json) => r.role === "PLANNER").status,
        "FAILED",
      );
    } finally {
      await finish(runId);
    }
  });

  test("회의 목록과 상세에서 발언·반응이 순서대로 나온다", async () => {
    const { runId } = await newRun();
    try {
      const meeting = await db.meeting.create({
        data: {
          runId,
          topic: "화면 검토",
          participants: ["PM", "DESIGNER"],
          status: "ENDED",
          outcome: "승인",
          startedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await db.meetingEntry.createMany({
        data: [
          {
            meetingId: meeting.id,
            kind: "REACTION",
            entryOrder: 2,
            eventSequence: 3,
            role: "PM",
            reactionKind: "NOD",
          },
          {
            meetingId: meeting.id,
            kind: "STATEMENT",
            entryOrder: 1,
            eventSequence: 2,
            role: "DESIGNER",
            text: "목록 화면부터 보여 드릴게요.",
          },
        ],
      });
      const list = await call(
        listMeetings(req("GET", `/api/runs/${runId}/meetings`), ctx(runId)),
      );
      assert.deepEqual(
        list.body.items.map((m: Json) => m.id),
        [meeting.id],
      );
      const detail = await call(
        getMeeting(req("GET", `/api/meetings/${meeting.id}`), ctx(meeting.id)),
      );
      assert.deepEqual(detail.body.statements, [
        {
          order: 1,
          sequence: 2,
          role: "DESIGNER",
          summary: "목록 화면부터 보여 드릴게요.",
        },
      ]);
      assert.deepEqual(detail.body.reactions, [
        { sequence: 3, role: "PM", kind: "NOD" },
      ]);
      assert.equal(detail.body.outcome, "승인");
      assert.equal(
        (await call(getMeeting(req("GET", "/api/meetings/없음"), ctx("없음"))))
          .status,
        404,
      );
      assert.equal(
        (
          await call(
            listMeetings(req("GET", "/api/runs/없음/meetings"), ctx("없음")),
          )
        ).status,
        404,
      );
    } finally {
      await finish(runId);
    }
  });
});

describe("공통 설정", () => {
  const withoutTokens = async (fn: () => Promise<void>) => {
    const keys = ["GITHUB_TOKEN", "VERCEL_TOKEN", "SUPABASE_ACCESS_APP_TOKEN"];
    const saved = keys.map((k) => process.env[k]);
    keys.forEach((k) => delete process.env[k]);
    try {
      await fn();
    } finally {
      keys.forEach((k, i) =>
        saved[i] === undefined
          ? delete process.env[k]
          : (process.env[k] = saved[i]),
      );
    }
  };

  test("연결 상태는 확인하기 전에는 연결됨으로 표시하지 않고 비밀 키를 담지 않는다", async () => {
    await withoutTokens(async () => {
      await db.connectionState.deleteMany({
        where: { workspaceId: WORKSPACE_ID },
      });
      const res = await call(getSettings());
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.connections.map((c: Json) => c.provider),
        ["github", "vercel", "supabase"],
      );
      for (const connection of res.body.connections) {
        assert.equal(connection.status, "NOT_CONNECTED");
        assert.match(connection.message, /\.env/);
      }
      assert.ok(!JSON.stringify(res.body).toLowerCase().includes('token":'));
    });
  });

  test("키가 없으면 확인해도 연결됨이 되지 않고 결과가 저장된다", async () => {
    await withoutTokens(async () => {
      const verify = (provider: string) =>
        call(
          verifyConnection(
            req("POST", `/api/settings/connections/${provider}/verify`),
            { params: Promise.resolve({ provider }) },
          ),
        );
      const res = await verify("github");
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "NOT_CONNECTED");
      assert.ok(res.body.checkedAt);
      const saved = await call(getSettings());
      assert.ok(
        saved.body.connections.find((c: Json) => c.provider === "github")
          .checkedAt,
      );
      assert.equal((await verify("gitlab")).status, 404);
    });
  });

  test("저장소 공개 범위와 실행 한도를 바꾸고 null로 되돌린다", async () => {
    const put = (body: unknown) =>
      call(putSettings(req("PUT", "/api/settings", body)));
    const changed = await put({
      repoVisibility: "PUBLIC",
      limits: { maxModelCalls: 50, maxEstimatedCost: 12.5 },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.repoVisibility, "PUBLIC");
    assert.equal(changed.body.limits.maxModelCalls, 50);
    assert.equal(changed.body.limits.maxEstimatedCost, 12.5);
    // 지정하지 않은 한도는 null이 아니라 기본값으로 읽힌다.
    assert.equal(
      changed.body.limits.maxFixAttempts,
      DEFAULT_RUN_LIMITS.maxFixAttempts,
    );
    const partial = await put({ limits: { maxFixAttempts: 2 } });
    assert.equal(partial.body.limits.maxModelCalls, 50);
    assert.equal(partial.body.limits.maxFixAttempts, 2);

    assert.equal((await put({ repoVisibility: "SECRET" })).status, 400);
    assert.equal((await put({ limits: { maxModelCalls: -1 } })).status, 400);
    assert.equal((await put({ limits: { maxModelCalls: 1.5 } })).status, 400);

    const restored = await put({
      repoVisibility: "PRIVATE",
      limits: {
        maxModelCalls: null,
        maxFixAttempts: null,
        maxEstimatedCost: null,
      },
    });
    assert.equal(restored.body.repoVisibility, "PRIVATE");
    // null로 되돌리면 저장값이 지워지고 기본값이 적용된다.
    assert.deepEqual(restored.body.limits, DEFAULT_RUN_LIMITS);
  });
});

describe("상태 확인", () => {
  test("DB 상태와 워커 heartbeat를 알려준다", async () => {
    await db.workerHeartbeat.deleteMany();
    let res = await call(getHealth());
    assert.equal(res.status, 200);
    assert.equal(res.body.database, "OK");
    assert.equal(res.body.worker, "UNKNOWN");
    assert.equal(res.body.web, "OK");

    await db.workerHeartbeat.create({
      data: { instanceId: "test-worker", lastSeenAt: new Date(), version: "t" },
    });
    res = await call(getHealth());
    assert.equal(res.body.worker, "OK");
    await db.workerHeartbeat.update({
      where: { instanceId: "test-worker" },
      data: { lastSeenAt: new Date(Date.now() - 120_000) },
    });
    res = await call(getHealth());
    assert.equal(res.body.worker, "DOWN");
    await db.workerHeartbeat.deleteMany();
  });
});

describe("결과와 검증", () => {
  async function realRun(
    projectId: string,
    status: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  ) {
    return db.run.create({
      data: {
        projectId,
        type: "INITIAL",
        mode: "REAL",
        status,
        ceoLevel: "DELEGATE",
        projectGeneration: 1,
        workflowVersion: "t",
        promptVersion: "t",
        modelConfig: {},
        limits: {},
        threadId: randomUUID(),
      },
    });
  }
  const getRes = (id: string) =>
    call(getResult(req("GET", `/api/projects/${id}/result`), ctx(id)));
  const item = (
    reportId: string,
    checkId: string,
    result: "PASS" | "FAIL" | "NOT_RUN" | "NOT_APPLICABLE",
    reason?: string,
  ) =>
    db.verificationItem.create({
      data: {
        reportId,
        checkId,
        description: `${checkId} 확인`,
        result,
        reason: reason ?? null,
      },
    });

  test("데모 실행은 제품 완료가 될 수 없다", async () => {
    const { project, runId } = await newRun();
    await finish(runId);
    const res = await getRes(project.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.completion.isDemo, true);
    assert.equal(res.body.completion.product, "NOT_VERIFIED");
    assert.equal(res.body.completion.build, "NOT_RUN");
    assert.equal(res.body.app, null);
    assert.equal(res.body.latestRunId, runId);
    assert.ok(res.body.remainingConstraints[0].includes("데모"));
    assert.equal((await getRes("없음")).status, 404);
  });

  test("필수 항목이 모두 통과하고 배포가 확인될 때만 제품 완료가 된다", async () => {
    const project = await makeProject();
    const run = await realRun(project.id);
    const report = await db.verificationReport.create({
      data: { runId: run.id, specVersion: 1, harnessVersion: "t" },
    });
    const deployment = await db.deployment.create({
      data: {
        projectId: project.id,
        runId: run.id,
        providerDeploymentId: "dpl_1",
        commitSha: "abc123",
        sourceDigest: "d",
        envRevision: "e1",
        url: "https://app.example",
        stage: "PUBLISHED",
      },
    });
    await db.externalResource.create({
      data: {
        projectId: project.id,
        provider: "github",
        kind: "REPOSITORY",
        externalId: "r1",
        url: "https://github.com/u/r",
      },
    });
    await db.project.update({
      where: { id: project.id },
      data: { lastGoodDeploymentId: deployment.id },
    });
    await item(report.id, "BUILD", "PASS");
    await item(report.id, "FINAL_URL", "PASS");
    await item(report.id, "APP-AC-001", "PASS");
    await item(
      report.id,
      "APP-AC-002",
      "NOT_APPLICABLE",
      "DB가 필요 없는 앱입니다.",
    );

    let res = await getRes(project.id);
    assert.deepEqual(res.body.completion, {
      build: "PASS",
      deployment: "PASS",
      product: "COMPLETE",
      isDemo: false,
    });
    assert.equal(res.body.app.url, "https://app.example");
    assert.equal(res.body.repository.commitSha, "abc123");
    assert.equal(res.body.repository.visibility, "PRIVATE");
    assert.equal(res.body.lastGood.deploymentId, "dpl_1");
    assert.deepEqual(res.body.remainingConstraints, []);

    await item(report.id, "APP-AC-003", "NOT_RUN");
    res = await getRes(project.id);
    assert.equal(res.body.completion.product, "NOT_VERIFIED");
    assert.ok(
      res.body.remainingConstraints.some((c: string) => c.startsWith("미검증")),
    );

    await item(report.id, "APP-AC-004", "FAIL");
    res = await getRes(project.id);
    assert.equal(res.body.completion.product, "INCOMPLETE");
    assert.equal(res.body.completion.build, "PASS");
    assert.equal(res.body.completion.deployment, "PASS");
  });

  test("검증 보고서는 요구사항별 결과를 보여 주고 없으면 404", async () => {
    const project = await makeProject();
    const run = await realRun(project.id, "FAILED");
    const verification = (id: string) =>
      call(
        getVerification(req("GET", `/api/runs/${id}/verification`), ctx(id)),
      );
    assert.equal((await verification(run.id)).status, 404);
    const report = await db.verificationReport.create({
      data: {
        runId: run.id,
        specVersion: 2,
        commitSha: "c1",
        harnessVersion: "t",
      },
    });
    await item(report.id, "APP-AC-001", "PASS");
    await item(report.id, "APP-AC-002", "FAIL");
    const res = await verification(run.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.target.specVersion, 2);
    assert.equal(res.body.target.commitSha, "c1");
    assert.deepEqual(
      res.body.items.map((i: Json) => [i.id, i.result]),
      [
        ["APP-AC-001", "PASS"],
        ["APP-AC-002", "FAIL"],
      ],
    );
    assert.equal((await verification("없음")).status, 404);
  });
});

describe("작업 공간 스트림", () => {
  test("접속한 뒤의 결정·상태 변화만 요약해서 보낸다", async () => {
    await releaseAll();
    const project = await makeProject();
    const run = (
      await call(
        startRun(
          req("POST", `/api/projects/${project.id}/runs`, {
            type: "INITIAL",
            mode: "DEMO",
            ceoLevel: "KEY_DECISIONS",
          }),
          ctx(project.id),
        ),
      )
    ).body;
    await db.run.update({
      where: { id: run.id },
      data: { status: "WAITING_CEO" },
    });
    const decision = await db.decision.create({
      data: {
        runId: run.id,
        kind: "INTEGRATED_REVIEW",
        status: "OPEN",
        proposalVersion: 1,
        proposalFingerprint: randomUUID(),
        title: "통합안",
        summary: "s",
        proposal: [],
        changesFromPrevious: [],
        options: [],
        openedAt: new Date(),
      },
    });

    const abort = new AbortController();
    try {
      const response = await streamWorkspace(
        new Request(`${BASE}/api/stream`, { signal: abort.signal }),
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /text\/event-stream/,
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const read = async (done: (t: string) => boolean, ms = 6000) => {
        const deadline = Date.now() + ms;
        while (!done(text)) {
          if (Date.now() > deadline)
            throw new Error(`대기 시간 초과. 받은 내용:\n${text}`);
          const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_, rej) =>
              setTimeout(
                () => rej(new Error(`대기 시간 초과. 받은 내용:\n${text}`)),
                Math.max(1, deadline - Date.now()),
              ),
            ),
          ]);
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
      };
      await read((t) => t.includes("retry:"));
      // 접속 직후 기준점을 읽는 동안 기다린다.
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.ok(
        !text.includes("workspace-event"),
        "접속 전의 변화는 보내지 않는다",
      );

      const answered = await call(
        respondDecision(
          req("POST", `/api/decisions/${decision.id}/response`, {
            proposalVersion: 1,
            choice: "APPROVE",
          }),
          ctx(decision.id),
        ),
      );
      assert.equal(answered.status, 200);
      await read(
        (t) =>
          t.includes("decision.answered") && t.includes("run.status_changed"),
      );
      assert.match(text, /event: workspace-event/);
      const payloads = [...text.matchAll(/data: (.+)\n/g)].map((m) =>
        JSON.parse(m[1]),
      );
      const answeredEvent = payloads.find(
        (p) => p.type === "decision.answered",
      );
      assert.equal(answeredEvent.decision.id, decision.id);
      assert.equal(answeredEvent.decision.projectId, project.id);
      const statusEvent = payloads.find((p) => p.type === "run.status_changed");
      assert.equal(statusEvent.runId, run.id);
      assert.equal(statusEvent.status, "QUEUED");
      assert.ok(!payloads.some((p) => p.type === "run.accepted"));
      await reader.cancel();
    } finally {
      abort.abort();
      await finish(run.id);
    }
  });
});
