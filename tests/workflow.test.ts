import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { POST as createProject } from "../src/app/api/projects/route";
import { GET as getProject } from "../src/app/api/projects/[id]/route";
import { POST as answerDecision } from "../src/app/api/decisions/[id]/route";

if (existsSync(".env")) process.loadEnvFile();

function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function waitFor(runId: string, status: string) {
  for (let i = 0; i < 200; i++) {
    const run = await db.run.findUniqueOrThrow({
      where: { id: runId },
      include: { artifacts: true, decisions: true, project: true },
    });
    if (run.status === status) return run;
    if (run.status === "FAILED") throw new Error(run.error ?? "실행 실패");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${status} 상태를 기다리는 시간이 초과되었습니다.`);
}
function startWorker() {
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
    stdio: "inherit",
    env: process.env,
  });
  return child;
}
async function stopWorker(child: ChildProcess) {
  if (child.exitCode !== null)
    throw new Error(`워커가 예상보다 먼저 종료되었습니다: ${child.exitCode}`);
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

test(
  "실제 DB에서 레벨별 중단, 워커 재시작, 중복 응답과 재개",
  { timeout: 90000 },
  async () => {
    let worker = startWorker();
    try {
      const invalid = await createProject(
        request({
          name: "실제 모드",
          idea: "아이디어",
          ceoLevel: "DELEGATE",
          mode: "REAL",
        }),
      );
      assert.equal(invalid.status, 400);
      const wrongType = await createProject(
        new Request("http://localhost/api", {
          method: "POST",
          headers: { "content-type": "text/plain; application/json" },
          body: "{}",
        }),
      );
      assert.equal(wrongType.status, 415);
      for (const level of ["DELEGATE", "KEY_DECISIONS", "COLLABORATIVE"]) {
        const created = await createProject(
          request({
            name: `통합 테스트 ${level}`,
            idea: "독서 기록 서비스",
            ceoLevel: level,
          }),
        );
        assert.equal(created.status, 201);
        const project = await created.json();
        const id: string = project.runs[0].id;
        const loaded = await getProject(new Request("http://localhost/api"), {
          params: Promise.resolve({ id: project.id }),
        });
        assert.equal((await loaded.json()).idea, "독서 기록 서비스");
        if (level !== "DELEGATE") {
          let run = await waitFor(id, "WAITING");
          assert.equal(run.artifacts.length, level === "COLLABORATIVE" ? 2 : 3);
          assert.equal(
            run.decisions[0].type,
            level === "COLLABORATIVE" ? "기능 범위" : "통합안 및 화면 구성",
          );
          if (level === "COLLABORATIVE") {
            await stopWorker(worker);
            worker = startWorker();
            run = await waitFor(id, "WAITING");
          }
          const decision = run.decisions[0];
          const responses = await Promise.all(
            [1, 2].map(() =>
              answerDecision(request({ response: "독서 날짜 추가" }), {
                params: Promise.resolve({ id: decision.id }),
              }),
            ),
          );
          assert.deepEqual(
            responses.map((r) => r.status),
            [200, 200],
          );
          const conflict = await answerDecision(
            request({ response: "다른 의견" }),
            { params: Promise.resolve({ id: decision.id }) },
          );
          assert.equal(conflict.status, 409);
          if (level === "COLLABORATIVE") {
            run = await waitFor(id, "WAITING");
            assert.equal(run.decisions.length, 2);
            assert.equal(run.decisions[1].type, "통합안 및 화면 구성");
            assert.ok(JSON.stringify(run.artifacts).includes("독서 날짜 추가"));
            const response = await answerDecision(
              request({ response: "화면 승인" }),
              { params: Promise.resolve({ id: run.decisions[1].id }) },
            );
            assert.equal(response.status, 200);
          }
        }
        const complete = await waitFor(id, "COMPLETED");
        assert.equal(complete.artifacts.length, 4);
        assert.equal(new Set(complete.artifacts.map((a) => a.type)).size, 4);
        assert.equal(
          complete.decisions.length,
          level === "COLLABORATIVE" ? 2 : 1,
        );
        assert.ok(
          JSON.stringify(complete.artifacts).includes("독서 기록 서비스"),
        );
        if (level !== "DELEGATE")
          assert.equal(
            complete.project.requirements.split("독서 날짜 추가").length - 1,
            1,
          );
      }
    } finally {
      await stopWorker(worker);
      await db.$disconnect();
    }
  },
);
