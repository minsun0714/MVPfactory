import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GET as listDecisions } from "@/app/api/decisions/route";
import { GET as getDecision } from "@/app/api/decisions/[id]/route";
import { POST as respondDecision } from "@/app/api/decisions/[id]/response/route";
import {
  GET as listProjects,
  POST as createProject,
} from "@/app/api/projects/route";
import { GET as getProject } from "@/app/api/projects/[id]/route";
import { POST as archiveProject } from "@/app/api/projects/[id]/archive/route";
import { POST as unarchiveProject } from "@/app/api/projects/[id]/unarchive/route";
import { POST as startRun } from "@/app/api/projects/[id]/runs/route";
import { GET as getRun } from "@/app/api/runs/[id]/route";
import { GET as listEvents } from "@/app/api/runs/[id]/events/route";
import { GET as streamEvents } from "@/app/api/runs/[id]/stream/route";
import { POST as scopeCheck } from "@/app/api/scope-check/route";
import { POST as pauseRun } from "@/app/api/runs/[id]/pause/route";
import { POST as resumeRun } from "@/app/api/runs/[id]/resume/route";
import { POST as retryRun } from "@/app/api/runs/[id]/retry/route";
import { GET as listArtifacts } from "@/app/api/runs/[id]/artifacts/route";
import { GET as getUsage } from "@/app/api/runs/[id]/usage/route";
import { GET as getArtifact } from "@/app/api/artifacts/[id]/route";
import { db, WORKSPACE_ID } from "@/lib/db";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { getContainer } from "@/server/container";
import { createRunUseCases } from "@/application/runs";
import { createRunRepository } from "@/infrastructure/prisma/run-repository";
// Contract tests inject readiness; they never execute external generation/deployment.
let executionAvailable = true;
before(() => {
  getContainer().runs = createRunUseCases(createRunRepository(db), {
    isRealModeAvailable: async () => executionAvailable,
  });
});

if (existsSync(".env")) process.loadEnvFile();

const BASE = "http://localhost";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function req(
  method: string,
  path: string,
  body?: unknown,
  opts: { key?: string | false; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST" && opts.key !== false && body !== undefined)
    headers["idempotency-key"] = opts.key ?? randomUUID();
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

const newProject = (extra: Json = {}) => ({
  name: `테스트 ${randomUUID().slice(0, 8)}`,
  idea: "독서 기록 서비스",
  ceoLevel: "KEY_DECISIONS",
  ...extra,
});
async function makeProject(extra: Json = {}) {
  const res = await call(
    createProject(req("POST", "/api/projects", newProject(extra))),
  );
  assert.equal(res.status, 201);
  return res.body;
}
const startBody = (extra: Json = {}) => ({
  type: "INITIAL",
  mode: "REAL",
  ceoLevel: "KEY_DECISIONS",
  ...extra,
});
async function begin(projectId: string, extra: Json = {}) {
  return call(
    startRun(
      req("POST", `/api/projects/${projectId}/runs`, startBody(extra)),
      ctx(projectId),
    ),
  );
}
/** 워커가 아직 없으므로 테스트가 Run을 끝내고 예약을 풀어 다음 테스트가 새 Run을 시작할 수 있게 한다. */
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
async function releaseAll() {
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
}

after(async () => {
  await getContainer().notifier.close();
  await db.$disconnect();
});

describe("프로젝트", () => {
  test("생성·조회·목록·보관·보관 해제", async () => {
    const project = await makeProject({ purpose: "독서량 추적" });
    assert.equal(project.archived, false);
    assert.equal(project.purpose, "독서량 추적");
    assert.equal(project.hasLiveApp, false);
    assert.equal(project.latestRun, null);

    const loaded = await call(
      getProject(req("GET", `/api/projects/${project.id}`), ctx(project.id)),
    );
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.idea, "독서 기록 서비스");

    const listed = await call(
      listProjects(req("GET", "/api/projects?limit=100")),
    );
    assert.ok(listed.body.items.some((item: Json) => item.id === project.id));

    assert.equal(
      (
        await archiveProject(
          req("POST", `/api/projects/${project.id}/archive`),
          ctx(project.id),
        )
      ).status,
      204,
    );
    const active = await call(
      listProjects(req("GET", "/api/projects?limit=100")),
    );
    assert.ok(!active.body.items.some((item: Json) => item.id === project.id));
    const archived = await call(
      listProjects(req("GET", "/api/projects?archived=true&limit=100")),
    );
    assert.ok(
      archived.body.items.some(
        (item: Json) => item.id === project.id && item.archived,
      ),
    );

    assert.equal(
      (
        await unarchiveProject(
          req("POST", `/api/projects/${project.id}/unarchive`),
          ctx(project.id),
        )
      ).status,
      204,
    );
    const again = await call(
      getProject(req("GET", `/api/projects/${project.id}`), ctx(project.id)),
    );
    assert.equal(again.body.archived, false);
  });

  test("목록은 커서로 이어서 읽는다", async () => {
    await makeProject();
    await makeProject();
    const first = await call(listProjects(req("GET", "/api/projects?limit=1")));
    assert.equal(first.body.items.length, 1);
    assert.ok(first.body.nextCursor);
    const second = await call(
      listProjects(
        req("GET", `/api/projects?limit=1&cursor=${first.body.nextCursor}`),
      ),
    );
    assert.equal(second.body.items.length, 1);
    assert.notEqual(second.body.items[0].id, first.body.items[0].id);
  });

  test("같은 키의 재요청은 같은 프로젝트를, 다른 내용은 409를 돌려준다", async () => {
    const key = randomUUID();
    const body = newProject();
    const first = await call(
      createProject(req("POST", "/api/projects", body, { key })),
    );
    const replay = await call(
      createProject(req("POST", "/api/projects", body, { key })),
    );
    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);
    const reused = await call(
      createProject(
        req(
          "POST",
          "/api/projects",
          { ...body, idea: "다른 아이디어" },
          { key },
        ),
      ),
    );
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");
  });

  test("동시에 같은 키로 요청해도 프로젝트는 하나만 만들어진다", async () => {
    const key = randomUUID();
    const body = newProject();
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        call(createProject(req("POST", "/api/projects", body, { key }))),
      ),
    );
    assert.ok(responses.every((res) => res.status === 201));
    assert.equal(new Set(responses.map((res) => res.body.id)).size, 1);
  });

  test("입력 오류, 키 누락, 형식, 출처, 없는 대상을 구분해 거절한다", async () => {
    const invalid = await call(
      createProject(
        req("POST", "/api/projects", { name: "", idea: "x", ceoLevel: "NONE" }),
      ),
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION_FAILED");
    assert.ok(
      invalid.body.error.details.fields.some((f: Json) => f.field === "name"),
    );

    const noKey = await call(
      createProject(req("POST", "/api/projects", newProject(), { key: false })),
    );
    assert.equal(noKey.status, 400);

    const wrongType = await call(
      createProject(
        new Request(`${BASE}/api/projects`, {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            "idempotency-key": randomUUID(),
          },
          body: "{}",
        }),
      ),
    );
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.body.error.code, "UNSUPPORTED_MEDIA_TYPE");

    const foreign = await call(
      createProject(
        req("POST", "/api/projects", newProject(), {
          headers: { origin: "http://evil.example" },
        }),
      ),
    );
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error.code, "FORBIDDEN_ORIGIN");

    const missing = await call(
      getProject(req("GET", "/api/projects/없는-id"), ctx("없는-id")),
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "NOT_FOUND");
    assert.equal(missing.body.error.retryable, false);
  });

  test("지원 범위 사전 확인", async () => {
    const ok = await call(
      scopeCheck(
        req(
          "POST",
          "/api/scope-check",
          { idea: "로그인 없이 쓰는 독서 기록" },
          { key: false },
        ),
      ),
    );
    assert.equal(ok.body.supported, true);
    const gap = await call(
      scopeCheck(
        req(
          "POST",
          "/api/scope-check",
          { idea: "회원가입이 필요한 서비스" },
          { key: false },
        ),
      ),
    );
    assert.equal(gap.body.supported, false);
    assert.equal(gap.body.gaps[0].requirement, "로그인·회원가입");
  });
});

describe("실행 시작", () => {
  test("실제 모드는 연동이 없으면 데모로 바꾸지 않고 거절한다", async () => {
    const project = await makeProject();
    executionAvailable = false;
    const res = await begin(project.id, { mode: "REAL" }).finally(() => {
      executionAvailable = true;
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "INTEGRATION_NOT_CONFIGURED");
    assert.equal(await db.run.count({ where: { projectId: project.id } }), 0);
  });

  test("접수하면 Run, 시작 Job, 예약, 첫 이벤트가 함께 만들어진다", async () => {
    await releaseAll();
    const project = await makeProject();
    const res = await begin(project.id);
    try {
      assert.equal(res.status, 202);
      assert.equal(res.body.status, "QUEUED");
      assert.equal(res.body.mode, "REAL");
      assert.equal(res.body.type, "INITIAL");
      assert.equal(res.body.lastSequence, 1);
      assert.deepEqual(res.body.openDecisionIds, []);

      const jobs = await db.job.findMany({ where: { runId: res.body.id } });
      assert.deepEqual(
        jobs.map((job) => [job.kind, job.status]),
        [["START", "QUEUED"]],
      );
      assert.equal(
        await db.activeRunLock.count({ where: { runId: res.body.id } }),
        1,
      );

      const events = await call(
        listEvents(
          req("GET", `/api/runs/${res.body.id}/events`),
          ctx(res.body.id),
        ),
      );
      assert.equal(events.body.lastSequence, 1);
      assert.equal(events.body.items[0].type, "run.accepted");
      assert.equal(events.body.items[0].sequence, 1);

      const run = await call(
        getRun(req("GET", `/api/runs/${res.body.id}`), ctx(res.body.id)),
      );
      assert.equal(run.body.id, res.body.id);
      const summary = await call(
        getProject(req("GET", `/api/projects/${project.id}`), ctx(project.id)),
      );
      assert.equal(summary.body.latestRun.id, res.body.id);
    } finally {
      await finish(res.body.id);
    }
  });

  test("같은 키의 재요청은 같은 Run을 돌려주고 새로 만들지 않는다", async () => {
    await releaseAll();
    const project = await makeProject();
    const key = randomUUID();
    const send = () =>
      call(
        startRun(
          req("POST", `/api/projects/${project.id}/runs`, startBody(), { key }),
          ctx(project.id),
        ),
      );
    const [a, b] = await Promise.all([send(), send()]);
    try {
      assert.equal(a.status, 202);
      assert.equal(b.status, 202);
      assert.equal(a.body.id, b.body.id);
      assert.equal(await db.run.count({ where: { projectId: project.id } }), 1);
    } finally {
      await finish(a.body.id);
    }
  });

  test("열린 Run이 있으면 다른 프로젝트도 시작할 수 없고, 동시 요청은 하나만 접수된다", async () => {
    await releaseAll();
    const [first, second] = [await makeProject(), await makeProject()];
    const results = await Promise.all([begin(first.id), begin(second.id)]);
    const accepted = results.filter((res) => res.status === 202);
    const rejected = results.filter((res) => res.status === 409);
    try {
      assert.equal(accepted.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].body.error.code, "ACTIVE_RUN_EXISTS");
      assert.equal(rejected[0].body.error.details.runId, accepted[0].body.id);
      assert.equal(
        await db.activeRunLock.count({ where: { workspaceId: WORKSPACE_ID } }),
        1,
      );
    } finally {
      await releaseAll();
      for (const res of accepted) await finish(res.body.id);
    }
  });

  test("최초 생성과 수정의 규칙", async () => {
    await releaseAll();
    const project = await makeProject();
    const revisionFirst = await begin(project.id, {
      type: "REVISION",
      feedback: "시간 추가",
    });
    assert.equal(revisionFirst.status, 409);
    assert.equal(revisionFirst.body.error.code, "INVALID_RUN_STATE");
    const noFeedback = await begin(project.id, { type: "REVISION" });
    assert.equal(noFeedback.status, 400);

    const initial = await begin(project.id);
    assert.equal(initial.status, 202);
    const duplicateInitial = await begin(project.id);
    assert.equal(duplicateInitial.status, 409);
    await finish(initial.body.id);
    const initialAgain = await begin(project.id);
    assert.equal(initialAgain.status, 409);
    assert.equal(initialAgain.body.error.code, "INVALID_RUN_STATE");

    const revision = await begin(project.id, {
      type: "REVISION",
      feedback: "공부 시간을 추가해줘",
    });
    try {
      assert.equal(revision.status, 202);
      assert.equal(revision.body.type, "REVISION");
      const row = await db.run.findUniqueOrThrow({
        where: { id: revision.body.id },
      });
      assert.equal(row.feedback, "공부 시간을 추가해줘");
      assert.equal(row.projectGeneration, 2);
      assert.notEqual(row.id, initial.body.id);
    } finally {
      await finish(revision.body.id);
    }
  });

  test("보관된 프로젝트에서는 시작할 수 없다", async () => {
    await releaseAll();
    const project = await makeProject();
    await archiveProject(
      req("POST", `/api/projects/${project.id}/archive`),
      ctx(project.id),
    );
    const res = await begin(project.id);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "INVALID_RUN_STATE");
  });
});

describe("이벤트", () => {
  async function runWithEvents(count: number) {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    for (let i = 0; i < count; i += 1)
      await db.$transaction((tx) =>
        appendRunEvent(tx, run.id, {
          type: "step.started",
          summary: `단계 ${i}`,
          data: { stageId: `W0${i}` },
        }),
      );
    return run.id as string;
  }

  test("순번은 1부터 비지 않고 이어지며 after로 이어서 읽는다", async () => {
    const runId = await runWithEvents(3);
    try {
      const all = await call(
        listEvents(req("GET", `/api/runs/${runId}/events`), ctx(runId)),
      );
      assert.deepEqual(
        all.body.items.map((e: Json) => e.sequence),
        [1, 2, 3, 4],
      );
      assert.equal(all.body.lastSequence, 4);
      const tail = await call(
        listEvents(
          req("GET", `/api/runs/${runId}/events?after=2&limit=1`),
          ctx(runId),
        ),
      );
      assert.deepEqual(
        tail.body.items.map((e: Json) => e.sequence),
        [3],
      );
      const none = await call(
        listEvents(req("GET", `/api/runs/${runId}/events?after=4`), ctx(runId)),
      );
      assert.deepEqual(none.body.items, []);
      const bad = await call(
        listEvents(
          req("GET", `/api/runs/${runId}/events?after=-1`),
          ctx(runId),
        ),
      );
      assert.equal(bad.status, 400);
    } finally {
      await finish(runId);
    }
  });

  test("동시에 이벤트를 추가해도 순번이 겹치거나 비지 않는다", async () => {
    const runId = await runWithEvents(0);
    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          db.$transaction((tx) =>
            appendRunEvent(tx, runId, {
              type: "step.started",
              summary: `병렬 ${i}`,
              data: { stageId: "W00" },
            }),
          ),
        ),
      );
      const rows = await db.runEvent.findMany({
        where: { runId },
        orderBy: { sequence: "asc" },
      });
      assert.deepEqual(
        rows.map((row) => row.sequence),
        Array.from({ length: 11 }, (_, i) => i + 1),
      );
    } finally {
      await finish(runId);
    }
  });

  test("보존 범위를 벗어난 순번은 410, 없는 Run은 404", async () => {
    const runId = await runWithEvents(2);
    try {
      await db.run.update({
        where: { id: runId },
        data: { eventsRetainedFrom: 3 },
      });
      const expired = await call(
        listEvents(req("GET", `/api/runs/${runId}/events?after=0`), ctx(runId)),
      );
      assert.equal(expired.status, 410);
      assert.equal(expired.body.error.code, "EVENTS_EXPIRED");
      const ok = await call(
        listEvents(req("GET", `/api/runs/${runId}/events?after=2`), ctx(runId)),
      );
      assert.equal(ok.status, 200);
      const missing = await call(
        listEvents(req("GET", "/api/runs/없는-run/events"), ctx("없는-run")),
      );
      assert.equal(missing.status, 404);
    } finally {
      await finish(runId);
    }
  });
});

describe("SSE 스트림", () => {
  async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    done: (text: string) => boolean,
    ms = 5000,
  ) {
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + ms;
    while (!done(text)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(`스트림 대기 시간 초과. 받은 내용:\n${text}`);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`스트림 대기 시간 초과. 받은 내용:\n${text}`)),
            remaining,
          ),
        ),
      ]);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
  }

  test("저장된 이벤트를 먼저 보내고 새 이벤트를 실시간으로 보낸다", async () => {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    const abort = new AbortController();
    try {
      const response = await streamEvents(
        new Request(`${BASE}/api/runs/${run.id}/stream`, {
          signal: abort.signal,
        }),
        ctx(run.id),
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /text\/event-stream/,
      );
      const reader = response.body!.getReader();

      let text = await readUntil(reader, (t) => t.includes("id: 1\n"));
      assert.match(text, /^retry: 2000/);
      assert.match(text, /event: run-event\n/);
      assert.match(text, /"type":"run.accepted"/);

      await db.$transaction((tx) =>
        appendRunEvent(tx, run.id, {
          type: "step.started",
          summary: "기획 시작",
          role: "PLANNER",
          data: { stageId: "W03" },
        }),
      );
      text = await readUntil(reader, (t) => t.includes("id: 2\n"));
      assert.match(text, /"type":"step.started"/);
      assert.match(text, /"role":"PLANNER"/);
      await reader.cancel();
    } finally {
      abort.abort();
      await finish(run.id);
    }
  });

  test("Last-Event-ID 이후의 이벤트만 이어서 보낸다", async () => {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    await db.$transaction((tx) =>
      appendRunEvent(tx, run.id, {
        type: "step.started",
        summary: "다음",
        data: { stageId: "W03" },
      }),
    );
    const abort = new AbortController();
    try {
      const response = await streamEvents(
        new Request(`${BASE}/api/runs/${run.id}/stream`, {
          headers: { "last-event-id": "1" },
          signal: abort.signal,
        }),
        ctx(run.id),
      );
      const reader = response.body!.getReader();
      const text = await readUntil(reader, (t) => t.includes("id: 2\n"));
      assert.ok(!text.includes("id: 1\n"));
      await reader.cancel();
    } finally {
      abort.abort();
      await finish(run.id);
    }
  });

  test("없는 Run과 보존 범위를 벗어난 순번은 스트림을 열기 전에 거절한다", async () => {
    const missing = await call(
      streamEvents(
        new Request(`${BASE}/api/runs/없는-run/stream`),
        ctx("없는-run"),
      ),
    );
    assert.equal(missing.status, 404);
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    try {
      await db.run.update({
        where: { id: run.id },
        data: { eventsRetainedFrom: 5 },
      });
      const expired = await call(
        streamEvents(
          new Request(`${BASE}/api/runs/${run.id}/stream?after=0`),
          ctx(run.id),
        ),
      );
      assert.equal(expired.status, 410);
    } finally {
      await finish(run.id);
    }
  });
});

describe("CEO 결정 응답", () => {
  /** 워커가 만들 상태를 DB에 직접 만든다: Run은 CEO 대기, 결정은 열림 */
  async function waitingDecision(extra: Json = {}, runExtra: Json = {}) {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    await db.run.update({
      where: { id: run.id },
      data: { status: "WAITING_CEO", ...runExtra },
    });
    const decision = await db.decision.create({
      data: {
        runId: run.id,
        kind: "INTEGRATED_REVIEW",
        status: "OPEN",
        proposalVersion: 1,
        proposalFingerprint: randomUUID(),
        title: "첫 버전, 이렇게 만들까요?",
        summary: "기능과 화면 통합안",
        proposal: [
          { heading: "이번에 만들 기능", items: ["기록 생성", "목록 조회"] },
        ],
        changesFromPrevious: [],
        options: [],
        openedAt: new Date(),
        ...extra,
      },
    });
    return { project, runId: run.id as string, decisionId: decision.id };
  }
  const respond = (id: string, body: unknown) =>
    call(
      respondDecision(
        req("POST", `/api/decisions/${id}/response`, body, { key: false }),
        ctx(id),
      ),
    );

  test("열린 결정을 목록과 상세로 볼 수 있다", async () => {
    const { runId, decisionId, project } = await waitingDecision();
    try {
      const listed = await call(
        listDecisions(
          req("GET", `/api/decisions?status=OPEN&projectId=${project.id}`),
        ),
      );
      assert.deepEqual(
        listed.body.items.map((d: Json) => d.id),
        [decisionId],
      );
      assert.equal(listed.body.items[0].projectId, project.id);
      const detail = await call(
        getDecision(
          req("GET", `/api/decisions/${decisionId}`),
          ctx(decisionId),
        ),
      );
      assert.equal(detail.body.status, "OPEN");
      assert.equal(detail.body.proposalVersion, 1);
      assert.equal(detail.body.proposal[0].items.length, 2);
      assert.equal(detail.body.response, null);
      const summary = await call(
        getProject(req("GET", `/api/projects/${project.id}`), ctx(project.id)),
      );
      assert.equal(summary.body.hasOpenDecision, true);
      const badStatus = await call(
        listDecisions(req("GET", "/api/decisions?status=NOPE")),
      );
      assert.equal(badStatus.status, 400);
    } finally {
      await finish(runId);
    }
  });

  test("승인하면 응답과 재개 Job과 이벤트가 함께 남고 Run은 재개를 기다린다", async () => {
    const { runId, decisionId } = await waitingDecision();
    try {
      const res = await respond(decisionId, {
        proposalVersion: 1,
        choice: "APPROVE",
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "ANSWERED");
      assert.equal(res.body.response.choice, "APPROVE");
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "QUEUED");
      const jobs = await db.job.findMany({ where: { runId, kind: "RESUME" } });
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].dedupeKey, `resume:${decisionId}`);
      const types = (
        await db.runEvent.findMany({
          where: { runId },
          orderBy: { sequence: "asc" },
        })
      ).map((e) => e.type);
      assert.deepEqual(types, [
        "run.accepted",
        "decision.answered",
        "run.status_changed",
      ]);
    } finally {
      await finish(runId);
    }
  });

  test("같은 응답을 동시에 여러 번 보내도 한 번만 적용된다", async () => {
    const { runId, decisionId } = await waitingDecision();
    try {
      const body = {
        proposalVersion: 1,
        choice: "REQUEST_CHANGES",
        comment: "공부 시간도 기록하고 싶어요",
      };
      const results = await Promise.all([
        respond(decisionId, body),
        respond(decisionId, body),
        respond(decisionId, body),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [200, 200, 200],
      );
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 1);
      assert.equal(
        await db.runEvent.count({
          where: { runId, type: "decision.answered" },
        }),
        1,
      );

      const replay = await respond(decisionId, body);
      assert.equal(replay.status, 200);
      assert.equal(
        await db.runEvent.count({
          where: { runId, type: "decision.answered" },
        }),
        1,
      );

      const conflict = await respond(decisionId, {
        proposalVersion: 1,
        choice: "APPROVE",
      });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error.code, "DECISION_ALREADY_ANSWERED");
    } finally {
      await finish(runId);
    }
  });

  test("서로 다른 응답이 동시에 오면 하나만 저장된다", async () => {
    const { runId, decisionId } = await waitingDecision();
    try {
      const results = await Promise.all([
        respond(decisionId, { proposalVersion: 1, choice: "APPROVE" }),
        respond(decisionId, {
          proposalVersion: 1,
          choice: "REQUEST_CHANGES",
          comment: "수정해 주세요",
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 1);
      const saved = await db.decision.findUniqueOrThrow({
        where: { id: decisionId },
      });
      assert.equal(saved.status, "ANSWERED");
    } finally {
      await finish(runId);
    }
  });

  test("제안 버전이 다르거나 입력이 틀리면 거절하고 결정은 열린 채로 남는다", async () => {
    const { runId, decisionId } = await waitingDecision({ proposalVersion: 3 });
    try {
      const stale = await respond(decisionId, {
        proposalVersion: 2,
        choice: "APPROVE",
      });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error.code, "PROPOSAL_VERSION_MISMATCH");
      assert.equal(stale.body.error.details.latestVersion, 3);
      assert.equal(
        (
          await respond(decisionId, {
            proposalVersion: 3,
            choice: "REQUEST_CHANGES",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await respond(decisionId, {
            proposalVersion: 3,
            choice: "SELECT_OPTION",
            optionId: "x",
          })
        ).status,
        400,
      );
      const missing = await respond("없는-결정", {
        proposalVersion: 1,
        choice: "APPROVE",
      });
      assert.equal(missing.status, 404);
      const saved = await db.decision.findUniqueOrThrow({
        where: { id: decisionId },
      });
      assert.equal(saved.status, "OPEN");
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 0);
    } finally {
      await finish(runId);
    }
  });

  test("일시정지 중이거나 아직 열리지 않은 결정에는 응답할 수 없다", async () => {
    const paused = await waitingDecision({}, { pauseRequested: true });
    try {
      const res = await respond(paused.decisionId, {
        proposalVersion: 1,
        choice: "APPROVE",
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, "RUN_PAUSED");
      assert.equal(
        (
          await db.decision.findUniqueOrThrow({
            where: { id: paused.decisionId },
          })
        ).status,
        "OPEN",
      );
      assert.equal(
        await db.job.count({ where: { runId: paused.runId, kind: "RESUME" } }),
        0,
      );
    } finally {
      await finish(paused.runId);
    }
    const prepared = await waitingDecision({
      status: "PREPARED",
      openedAt: null,
    });
    try {
      const res = await respond(prepared.decisionId, {
        proposalVersion: 1,
        choice: "APPROVE",
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, "DECISION_NOT_OPEN");
    } finally {
      await finish(prepared.runId);
    }
  });

  test("예외 결정은 제안에 있는 선택지로만 응답한다", async () => {
    const { runId, decisionId } = await waitingDecision({
      kind: "EXCEPTION",
      options: [
        { id: "reduce", label: "범위 축소", description: "기능을 줄입니다." },
        { id: "stop", label: "중단", description: "여기서 멈춥니다." },
      ],
    });
    try {
      assert.equal(
        (await respond(decisionId, { proposalVersion: 1, choice: "APPROVE" }))
          .status,
        400,
      );
      assert.equal(
        (
          await respond(decisionId, {
            proposalVersion: 1,
            choice: "SELECT_OPTION",
            optionId: "other",
          })
        ).status,
        400,
      );
      const ok = await respond(decisionId, {
        proposalVersion: 1,
        choice: "SELECT_OPTION",
        optionId: "reduce",
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.response.optionId, "reduce");
    } finally {
      await finish(runId);
    }
  });
});

describe("실행 제어", () => {
  const control = (fn: typeof pauseRun, runId: string) =>
    call(fn(req("POST", `/api/runs/${runId}/x`), ctx(runId)));
  const eventTypes = async (runId: string) =>
    (
      await db.runEvent.findMany({
        where: { runId },
        orderBy: { sequence: "asc" },
      })
    ).map((e) => e.type);
  async function newRun() {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    return { project, runId: run.id as string };
  }

  test("대기 중인 Run은 바로 정지하고 재개하면 대기열로 돌아간다", async () => {
    const { runId } = await newRun();
    try {
      const paused = await control(pauseRun, runId);
      assert.equal(paused.status, 202);
      assert.equal(paused.body.status, "PAUSED");
      assert.deepEqual(await eventTypes(runId), [
        "run.accepted",
        "run.pause_requested",
        "run.paused",
        "run.status_changed",
      ]);

      const again = await control(pauseRun, runId);
      assert.equal(again.body.status, "PAUSED");
      assert.equal((await eventTypes(runId)).length, 4);

      const resumed = await control(resumeRun, runId);
      assert.equal(resumed.body.status, "QUEUED");
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 1);
      const resumedAgain = await control(resumeRun, runId);
      assert.equal(resumedAgain.body.status, "QUEUED");
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 1);
    } finally {
      await finish(runId);
    }
  });

  test("진행 중인 Run은 정지 요청만 저장하고 재개로 요청을 취소할 수 있다", async () => {
    const { runId } = await newRun();
    try {
      await db.run.update({
        where: { id: runId },
        data: { status: "RUNNING" },
      });
      const requested = await control(pauseRun, runId);
      assert.equal(requested.body.status, "RUNNING");
      assert.equal(requested.body.pauseRequested, true);
      assert.equal((await eventTypes(runId)).at(-1), "run.pause_requested");
      const twice = await control(pauseRun, runId);
      assert.equal(twice.body.pauseRequested, true);
      assert.equal(
        (await eventTypes(runId)).filter((t) => t === "run.pause_requested")
          .length,
        1,
      );

      const cancelled = await control(resumeRun, runId);
      assert.equal(cancelled.body.pauseRequested, false);
      assert.equal(cancelled.body.status, "RUNNING");
    } finally {
      await finish(runId);
    }
  });

  test("CEO 대기 중 정지하면 응답이 막히고, 재개하면 다시 CEO 대기로 돌아간다", async () => {
    const { runId } = await newRun();
    try {
      await db.run.update({
        where: { id: runId },
        data: { status: "WAITING_CEO" },
      });
      const decision = await db.decision.create({
        data: {
          runId,
          kind: "INTEGRATED_REVIEW",
          status: "OPEN",
          proposalVersion: 1,
          proposalFingerprint: randomUUID(),
          title: "검토",
          summary: "요약",
          proposal: [],
          changesFromPrevious: [],
          options: [],
          openedAt: new Date(),
        },
      });
      assert.equal((await control(pauseRun, runId)).body.status, "PAUSED");
      const blocked = await call(
        respondDecision(
          req(
            "POST",
            `/api/decisions/${decision.id}/response`,
            { proposalVersion: 1, choice: "APPROVE" },
            { key: false },
          ),
          ctx(decision.id),
        ),
      );
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error.code, "RUN_PAUSED");

      const resumed = await control(resumeRun, runId);
      assert.equal(resumed.body.status, "WAITING_CEO");
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 0);
      const ok = await call(
        respondDecision(
          req(
            "POST",
            `/api/decisions/${decision.id}/response`,
            { proposalVersion: 1, choice: "APPROVE" },
            { key: false },
          ),
          ctx(decision.id),
        ),
      );
      assert.equal(ok.status, 200);
    } finally {
      await finish(runId);
    }
  });

  test("차단 사유는 정지했다 재개해도 해소되지 않는다", async () => {
    const { runId } = await newRun();
    try {
      await db.run.update({
        where: { id: runId },
        data: { status: "BLOCKED", blockedReason: "CONNECTION_MISSING" },
      });
      assert.equal((await control(pauseRun, runId)).body.status, "PAUSED");
      const resumed = await control(resumeRun, runId);
      assert.equal(resumed.body.status, "BLOCKED");
      assert.equal(resumed.body.blockedReason, "CONNECTION_MISSING");
      assert.equal(await db.job.count({ where: { runId, kind: "RESUME" } }), 0);
    } finally {
      await finish(runId);
    }
  });

  test("끝난 Run은 정지·재개할 수 없고 없는 Run은 404", async () => {
    const { runId } = await newRun();
    await finish(runId);
    assert.equal(
      (await control(pauseRun, runId)).body.error.code,
      "INVALID_RUN_STATE",
    );
    assert.equal(
      (await control(resumeRun, runId)).body.error.code,
      "INVALID_RUN_STATE",
    );
    assert.equal((await control(pauseRun, "없는-run")).status, 404);
  });

  test("실패한 Run을 같은 runId로 다시 시도하고 동시 요청은 한 번만 처리한다", async () => {
    const { runId } = await newRun();
    await db.run.update({
      where: { id: runId },
      data: {
        failure: { stage: "W09", message: "빌드 실패", retryable: true },
      },
    });
    await db.job.updateMany({ where: { runId }, data: { status: "FAILED" } });
    await finish(runId, "FAILED");
    try {
      const results = await Promise.all([
        control(retryRun, runId),
        control(retryRun, runId),
        control(retryRun, runId),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [202, 202, 202],
      );
      assert.ok(
        results.every((r) => r.body.id === runId && r.body.status === "QUEUED"),
      );
      assert.equal(results[0].body.failure, null);
      assert.equal(
        await db.job.count({ where: { runId, kind: "RECOVER" } }),
        1,
      );
      const recover = await db.job.findFirstOrThrow({
        where: { runId, kind: "RECOVER" },
      });
      assert.ok(recover.causeJobId);
      assert.equal(await db.activeRunLock.count({ where: { runId } }), 1);
      assert.equal(
        (await eventTypes(runId)).filter((t) => t === "run.status_changed")
          .length,
        1,
      );
    } finally {
      await finish(runId);
    }
  });

  test("다시 시도는 실패한 Run에만, 다른 열린 Run이 없을 때만, 최신 목표일 때만 가능하다", async () => {
    const { project, runId } = await newRun();
    await finish(runId, "FAILED");
    // 다른 Run이 열려 있으면 거절한다.
    const other = await makeProject();
    const running = (await begin(other.id)).body;
    try {
      const conflict = await control(retryRun, runId);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.error.code, "ACTIVE_RUN_EXISTS");
      assert.equal(conflict.body.error.details.runId, running.id);
      assert.equal(
        (await db.run.findUniqueOrThrow({ where: { id: runId } })).status,
        "FAILED",
      );
    } finally {
      await finish(running.id);
    }
    // 더 최신 목표가 접수되었으면 거절한다.
    await db.project.update({
      where: { id: project.id },
      data: { projectGeneration: 5 },
    });
    const stale = await control(retryRun, runId);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "STALE_GENERATION");
    // 성공한 Run은 다시 시도할 수 없다.
    await db.run.update({
      where: { id: runId },
      data: { status: "SUCCEEDED" },
    });
    assert.equal(
      (await control(retryRun, runId)).body.error.code,
      "INVALID_RUN_STATE",
    );
  });
});

describe("산출물과 사용량", () => {
  test("산출물 목록·상세와 사용량을 읽는다", async () => {
    await releaseAll();
    const project = await makeProject();
    const run = (await begin(project.id)).body;
    try {
      const artifact = await db.artifact.create({
        data: {
          runId: run.id,
          author: "PLANNER",
          type: "PRODUCT_SPEC",
          title: "기획 결과",
          schemaVersion: 1,
          checksum: "c1",
          content: { 목적: "독서 기록" },
        },
      });
      await db.artifact.create({
        data: {
          runId: run.id,
          author: "SYSTEM",
          type: "DELEGATION_RATIONALE",
          title: "위임 확정 근거",
          schemaVersion: 1,
          checksum: "c2",
          content: { 근거: "위임" },
        },
      });
      const list = await call(
        listArtifacts(req("GET", `/api/runs/${run.id}/artifacts`), ctx(run.id)),
      );
      assert.equal(list.status, 200);
      assert.deepEqual(
        list.body.items.map((a: Json) => a.author),
        ["PLANNER", "SYSTEM"],
      );
      assert.equal(list.body.items[0].content, undefined);

      const detail = await call(
        getArtifact(
          req("GET", `/api/artifacts/${artifact.id}`),
          ctx(artifact.id),
        ),
      );
      assert.deepEqual(detail.body.content, { 목적: "독서 기록" });
      assert.equal(detail.body.downloadUrl, null);
      assert.equal(
        (
          await call(
            getArtifact(req("GET", "/api/artifacts/없음"), ctx("없음")),
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call(
            listArtifacts(req("GET", "/api/runs/없음/artifacts"), ctx("없음")),
          )
        ).status,
        404,
      );

      const usage = await call(
        getUsage(req("GET", `/api/runs/${run.id}/usage`), ctx(run.id)),
      );
      assert.equal(usage.body.usage.modelCalls, 0);
      assert.equal(usage.body.usage.estimatedCost, null);
      assert.equal(usage.body.limits.maxModelCalls, null);
      assert.equal(
        (await call(getUsage(req("GET", "/api/runs/없음/usage"), ctx("없음"))))
          .status,
        404,
      );
    } finally {
      await finish(run.id);
    }
  });
});
