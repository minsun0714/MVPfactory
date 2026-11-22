import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { createRoleAgents } from "@/application/agents";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { GitHubClient } from "@/application/github";
import type { VercelClient } from "@/application/vercel";
import { GET as getResult } from "@/app/api/projects/[id]/result/route";
import { Client } from "pg";
import type { SupabaseAdmin } from "@/application/app-database";
import { schemaNameFor } from "@/domain/data-plan";
import { createRedactor } from "@/domain/secrets";
import { createAppDatabaseStore } from "@/infrastructure/prisma/app-database-store";
import { db, WORKSPACE_ID } from "@/lib/db";
import { createRunRepository } from "@/infrastructure/prisma/run-repository";
import { createDockerSandbox } from "@/infrastructure/sandbox/docker-sandbox";
import { createLocalSourceStorage } from "@/infrastructure/storage/local-source-storage";
import {
  createWorkerRuntime,
  type WorkerRuntime,
} from "@/server/worker-runtime";
import { dockerSkipReason } from "@tests/helpers/docker";
import { scriptedModel, systemOf } from "@tests/helpers/scripted-model";

const skip = dockerSkipReason();
const SECRET = "run-secret-token-abcdef123456";
const connectionString = process.env.DATABASE_URL!;
const dirs: string[] = [];
const runtimes: WorkerRuntime[] = [];

const pkg = (testScript: string) =>
  JSON.stringify({
    name: "reading-log",
    version: "1.0.0",
    private: true,
    scripts: { build: "node build.js", test: testScript },
  });
const SOURCE_BAD = [
  { 경로: "package.json", 내용: pkg("node --test") },
  { 경로: "build.js", 내용: "require('fs').writeFileSync('built.txt','ok')" },
  {
    경로: "app.test.js",
    내용: "require('node:test')('틀림', () => require('node:assert').equal(1, 2))",
  },
];
const FIX = [
  {
    경로: "app.test.js",
    내용: "require('node:test')('맞음', () => require('node:assert').equal(1, 1))",
  },
];
const MEETING_ROLES = ["PM", "PLANNER", "DESIGNER", "DEVELOPER"];

/** 역할을 system 문장으로 알아보고 형식에 맞는 답을 돌려주는 모의 모델 */
const DB_PLAN = {
  tables: [
    {
      name: "books",
      fields: [{ name: "title", type: "text", required: true }],
      access: { read: true, insert: true, update: false, delete: false },
    },
  ],
};

function team(
  opts: { alwaysBroken?: boolean; needsDb?: boolean; needsAuth?: boolean } = {},
) {
  return scriptedModel((request) => {
    const system = systemOf(request);
    if (system.includes("역할: PM."))
      return JSON.stringify({
        범위요약: "독서 기록",
        핵심사용자: "독자",
        제외할것: "로그인",
        범위검토: "지원 범위 안",
      });
    if (system.includes("역할: 기획자"))
      return JSON.stringify({
        목적: "독서 기록",
        포함범위: ["기록 추가와 목록"],
        제외범위: ["로그인"],
        기능: [
          {
            id: "APP-REQ-001",
            이름: "기록 추가",
            흐름: ["제목 입력", "저장"],
            데이터사용: opts.needsDb
              ? [{ 테이블: "books", 동작: "insert" }]
              : [],
          },
          {
            id: "APP-REQ-002",
            이름: "목록 보기",
            흐름: ["목록 확인"],
            데이터사용: opts.needsDb ? [{ 테이블: "books", 동작: "read" }] : [],
          },
        ],
        데이터: "제목",
        완료조건: [
          { id: "APP-AC-001", 기능: "APP-REQ-001", 내용: "추가하면 보인다" },
          {
            id: "APP-AC-002",
            기능: "APP-REQ-002",
            내용: "새로고침해도 남는다",
          },
          {
            id: "APP-AC-003",
            기능: "APP-REQ-002",
            내용: "빈 목록 안내가 보인다",
          },
        ],
        인증필요: opts.needsAuth ?? false,
        ...(opts.needsAuth ? { 인증근거: AUTH_REQUEST } : {}),
        데이터저장: opts.needsDb ? "필요" : "불필요",
        ...(opts.needsDb ? { 데이터계획: DB_PLAN } : {}),
      });
    if (system.includes("역할: 디자이너"))
      return JSON.stringify({
        화면: [
          {
            id: "SCR-001",
            이름: "목록",
            기능: ["APP-REQ-002"],
            주행동: "기록 확인",
            행동: ["목록 확인"],
            정상: "기록 목록",
            빈상태: "빈 목록 안내",
            로딩: "목록 스켈레톤",
            오류: "다시 시도 버튼",
          },
          {
            id: "SCR-002",
            이름: "입력",
            기능: ["APP-REQ-001"],
            주행동: "저장",
            행동: ["제목 입력", "저장"],
            정상: "입력 폼",
            빈상태: "빈 입력 안내",
            로딩: "저장 중 표시",
            오류: "입력 오류 안내",
          },
        ],
        브리프: {
          모드: "Operate",
          대상: "독자",
          과업: "읽은 책 기록",
          방향: "차분한 중립색",
          레이아웃: "목록 위 입력",
          피할것: ["장식 애니메이션"],
          가정: [],
        },
        연결: "목록에서 입력으로 이동",
      });
    if (system.includes("역할: 문서 검토 회의"))
      return JSON.stringify({
        발언: MEETING_ROLES.map((역할, i) => ({ 역할, 내용: `검토 ${i + 1}` })),
        문제: [],
      });
    if (system.includes("역할: 회의 기록자"))
      return JSON.stringify({
        발언: Array.from({ length: 6 }, (_, i) => ({
          역할: MEETING_ROLES[i % 4],
          내용: `의견 ${i + 1}`,
        })),
      });
    if (system.includes("수정 단계"))
      return JSON.stringify({
        파일: opts.alwaysBroken ? SOURCE_BAD.slice(2) : FIX,
      });
    return JSON.stringify({ 파일: SOURCE_BAD });
  });
}

/** 인증이 필요한 실행에서 대표가 직접 쓴 요구 문장 */
const AUTH_REQUEST = "로그인해서 내 독서 기록만 보고 싶어요";

async function startReal(maxFixAttempts: number, idea = "독서 기록 서비스") {
  await db.job.updateMany({
    where: { status: "QUEUED", run: { status: { not: "QUEUED" } } },
    data: { status: "DONE", noOpReason: "테스트 정리" },
  });
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
  const project = await db.project.create({
    data: {
      workspaceId: WORKSPACE_ID,
      name: `실제 ${randomUUID().slice(0, 6)}`,
      idea,
      ceoLevel: "DELEGATE",
    },
  });
  const run = await createRunRepository(db).start(project.id, {
    key: randomUUID(),
    request: { type: "INITIAL", mode: "REAL", ceoLevel: "DELEGATE" },
  });
  await db.run.update({
    where: { id: run.id },
    data: {
      limits: {
        maxModelCalls: 50,
        maxFixAttempts,
        maxActiveSeconds: 1800,
        maxEstimatedCost: null,
      },
    },
  });
  return { runId: run.id, projectId: project.id };
}

async function runtimeWith(
  model: ReturnType<typeof team>,
  release?: NonNullable<
    Parameters<typeof createWorkerRuntime>[0]["real"]
  >["release"],
) {
  const dir = mkdtempSync(join(tmpdir(), "mvp-src-"));
  dirs.push(dir);
  const runtime = await createWorkerRuntime({
    connectionString,
    demoDelayMs: 0,
    redact: createRedactor([SECRET]),
    real: {
      model,
      // Fixture-only writer. Production always injects createCodexWriter.
      codeWriter: {
        async write(input) {
          const agent = createRoleAgents(model);
          const changed = input.files.length
            ? await agent.fixSource(
                input.context,
                input.files,
                input.evidence ?? "",
                input.data,
              )
            : await agent.generateSource(
                input.context,
                input.spec ?? {},
                input.screens ?? {},
                input.data,
              );
          const merged = new Map(input.files.map((file) => [file.path, file]));
          for (const file of changed) merged.set(file.path, file);
          return {
            files: [...merged.values()],
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
      },
      price: { inputPerMTok: 1, outputPerMTok: 2 },
      sandbox: createDockerSandbox({
        image: "node:22-slim",
        namespace: "test",
      }),
      storage: createLocalSourceStorage(dir),
      secrets: [SECRET],
      release,
    },
  });
  runtimes.push(runtime);
  return { runtime, dir };
}

before(async () => {
  await db.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID },
    update: {},
  });
});
after(async () => {
  for (const runtime of runtimes) await runtime.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  await db.$disconnect();
});

describe(
  "실제 실행 워크플로우(모의 모델 + 실제 Docker 샌드박스)",
  { skip },
  () => {
    test("기획→설계→확정→소스 생성→실패→자동 수정→통과를 거치되, 배포 전이라 완료로 끝내지 않는다", async () => {
      const model = team();
      const { runtime, dir } = await runtimeWith(model);
      const { runId } = await startReal(3);
      await runtime.drain();

      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      // 배포 단계가 없으므로 성공이 아니다. 이유를 숨기지 않는다.
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /GitHub.*Vercel.*구현되지 않아/,
      );
      assert.notEqual(run.status, "SUCCEEDED");

      const artifacts = await db.artifact.findMany({ where: { runId } });
      assert.deepEqual(artifacts.map((a) => a.type).sort(), [
        "DELEGATION_RATIONALE",
        "DOCUMENT_REVIEW",
        "IMPLEMENTATION_RESULT",
        "INTAKE_BRIEF",
        "PRODUCT_SPEC",
        "SCREEN_PLAN",
      ]);
      // 화면 설계 뒤 팀이 두 문서를 함께 검토한 회의가 남는다.
      assert.ok(
        await db.meeting.findFirst({
          where: { runId, topic: { startsWith: "기획·화면 문서 검토" } },
        }),
      );
      assert.ok(
        !JSON.stringify(artifacts).includes("데모 안내"),
        "실제 산출물에 데모 문구가 없다",
      );

      // 처음 소스는 테스트 실패, 수정 뒤 통과. 보고서가 둘 다 남는다.
      const reports = await db.verificationReport.findMany({
        where: { runId },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(reports.length, 2);
      assert.equal(
        reports[0].items.find((i) => i.checkId === "TESTS")!.result,
        "FAIL",
      );
      assert.equal(
        reports[1].items.find((i) => i.checkId === "TESTS")!.result,
        "PASS",
      );
      assert.equal(
        reports[1].items.find((i) => i.checkId === "BUILD")!.result,
        "PASS",
      );
      assert.notEqual(reports[0].sourceDigest, reports[1].sourceDigest);

      // 사용량: 모델 호출 수·수정 횟수가 원장과 합계에 맞게 기록된다.
      assert.equal(run.usageModelCalls, model.calls.length);
      assert.equal(run.usageFixAttempts, 1);
      assert.equal(
        await db.usageRecord.count({ where: { runId, kind: "MODEL_CALL" } }),
        model.calls.length,
      );
      assert.ok(Number(run.usageCostAmount) > 0);

      // 합격한 소스는 샌드박스 밖에 보존되고, 보고서와 같은 식별자로 묶인다.
      const snapshot = await db.sourceSnapshot.findFirstOrThrow({
        where: { runId },
      });
      assert.equal(snapshot.sourceDigest, reports[1].sourceDigest);
      assert.ok(existsSync(join(dir, snapshot.storageRef)));
      const saved = await createLocalSourceStorage(dir).get(
        snapshot.storageRef,
      );
      assert.ok(
        saved.some((f) => f.path === "package-lock.json"),
        "하네스가 만든 lock 파일이 포함된다",
      );
      assert.equal(
        saved
          .find((f) => f.path === "app.test.js")!
          .content.toString()
          .includes("equal(1, 1)"),
        true,
        "수정된 내용이 보존된다",
      );
      // 확정 사양에서 만든 문서가 소스와 함께 보존된다(자동 수정 뒤에도 같은 확정본).
      // 실제 실행의 디자이너는 저장소에 고정한 Impeccable 지침을 쓴다.
      assert.match(
        String(saved.find((f) => f.path === "docs/DESIGN.md")?.content),
        /디자인 지침: Impeccable 4\.10\.0/,
      );
      assert.ok(
        model.calls.some((call) =>
          systemOf(call).includes(
            '<design_guide name="Impeccable" version="4.10.0">',
          ),
        ),
      );
      const prd = saved.find((f) => f.path === "docs/PRD.md");
      assert.match(String(prd?.content), /확정 사양 버전 \d+/);
      assert.match(String(prd?.content), /### APP-REQ-001 기록 추가/);
      assert.match(
        String(saved.find((f) => f.path === "docs/VERIFICATION.md")?.content),
        /\| APP-AC-003 \| APP-REQ-002 \| 빈 목록 안내가 보인다 \| .* \| 검증 전 \|/,
      );

      // 회의는 모델이 쓴 발언으로 기록된다.
      const entries = await db.meetingEntry.findMany({
        where: { meeting: { runId } },
      });
      assert.ok(entries.some((e) => e.text?.startsWith("의견")));
      assert.equal(
        await db.runEvent.count({
          where: { runId, type: "verification.recorded" },
        }),
        2,
      );
    });

    test("수정 한도(0)를 넘겨 고치지 않고 실패로 끝낸다", async () => {
      const model = team({ alwaysBroken: true });
      const { runtime } = await runtimeWith(model);
      const { runId } = await startReal(0);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /빌드·테스트를 통과하지 못했어요\(자동 수정 0번\)/,
      );
      assert.equal(run.usageFixAttempts, 0);
      assert.equal(
        await db.sourceSnapshot.count({ where: { runId } }),
        0,
        "통과하지 못한 소스는 보존하지 않는다",
      );
      assert.equal(await db.verificationReport.count({ where: { runId } }), 1);
    });

    test("모델 호출 한도에 도달하면 더 부르지 않고 멈춘다", async () => {
      const model = team();
      const { runtime } = await runtimeWith(model);
      const { runId } = await startReal(3);
      await db.run.update({
        where: { id: runId },
        data: {
          limits: {
            maxModelCalls: 2,
            maxFixAttempts: 3,
            maxActiveSeconds: 1800,
            maxEstimatedCost: null,
          },
        },
      });
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /모델 호출 횟수 한도에 도달/,
      );
      assert.equal(model.calls.length, 2);
    });

    test("실제 실행 구성이 없으면 REAL Run은 가짜로 진행하지 않고 실패한다", async () => {
      const runtime = await createWorkerRuntime({
        connectionString,
        demoDelayMs: 0,
      });
      runtimes.push(runtime);
      const { runId } = await startReal(3);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /실제 실행 연동이 준비되지 않았/,
      );
      assert.equal(await db.artifact.count({ where: { runId } }), 0);
    });

    test("검증을 통과한 소스를 설정된 계정의 GitHub 저장소에 올리고, 재시도해도 중복으로 올리지 않는다", async () => {
      const pushed: { owner: string; files: string[]; message: string }[] = [];
      let created = 0;
      const repos = new Map<
        string,
        {
          id: string;
          name: string;
          htmlUrl: string;
          defaultBranch: string;
          description: string | null;
        }
      >();
      const client: GitHubClient = {
        authenticatedLogin: async () => "minsun0714",
        getRepository: async (_o, name) => repos.get(name) ?? null,
        createRepository: async (owner, i) => {
          created += 1;
          const repo = {
            id: "42",
            name: i.name,
            htmlUrl: `https://github.com/${owner}/${i.name}`,
            defaultBranch: "main",
            description: i.description,
          };
          repos.set(i.name, repo);
          return repo;
        },
        recentCommits: async () =>
          pushed.map((p, n) => ({ sha: `sha${n + 1}`, message: p.message })),
        commitFiles: async (owner, _n, _b, files, message) => {
          pushed.push({ owner, files: files.map((f) => f.path), message });
          return { sha: `sha${pushed.length}` };
        },
      };
      const { runtime } = await runtimeWith(team(), {
        github: {
          client,
          target: async () => ({ owner: "minsun0714", isPrivate: true }),
        },
      });
      const { runId, projectId } = await startReal(3);
      await runtime.drain();

      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(
        run.status,
        "FAILED",
        "Vercel 배포가 없으니 아직 완료가 아니다",
      );
      assert.match(
        (run.failure as { message: string }).message,
        /GitHub에 소스를 올렸어요\(https:\/\/github\.com\/minsun0714\/mvp-.*Vercel 배포가 아직 구현되지 않아/,
      );
      assert.equal(created, 1);
      assert.equal(pushed.length, 1);
      assert.equal(pushed[0].owner, "minsun0714");
      assert.ok(pushed[0].files.includes("package-lock.json"));
      assert.ok(!pushed[0].files.some((f) => f.startsWith(".env")));
      const snapshot = await db.sourceSnapshot.findFirstOrThrow({
        where: { runId },
      });
      assert.match(
        pushed[0].message,
        new RegExp(`Source-Digest: ${snapshot.sourceDigest}`),
      );
      const repo = await db.externalResource.findFirstOrThrow({
        where: { projectId, provider: "github", kind: "REPOSITORY" },
      });
      assert.equal(repo.externalId, "42");
      assert.deepEqual(repo.meta, { visibility: "PRIVATE" });

      // 재시도하면 체크포인트에서 마무리만 다시 하고, 원장 덕분에 다시 만들거나 올리지 않는다.
      await createRunRepository(db).retry(runId);
      await runtime.drain();
      assert.equal(created, 1);
      assert.equal(pushed.length, 1);
    });

    test("GitHub 반영 → Vercel 배포 → 운영 주소 확인까지 끝나면 실행은 성공이지만 제품은 미검증으로 남는다", async () => {
      const repos = new Map<
        string,
        {
          id: string;
          name: string;
          htmlUrl: string;
          defaultBranch: string;
          description: string | null;
        }
      >();
      const github: GitHubClient = {
        authenticatedLogin: async () => "minsun0714",
        getRepository: async (_o, name) => repos.get(name) ?? null,
        createRepository: async (owner, i) => {
          const repo = {
            id: "7",
            name: i.name,
            htmlUrl: `https://github.com/${owner}/${i.name}`,
            defaultBranch: "main",
            description: i.description,
          };
          repos.set(i.name, repo);
          return repo;
        },
        recentCommits: async () => [],
        commitFiles: async () => ({ sha: "abc123" }),
      };
      let deployed = 0;
      const vercel: VercelClient = {
        setProjectEnv: async () => {},
        authenticatedUsername: async () => "minsun0714",
        getProject: async () => null,
        createProject: async (name) => ({ id: "prj_9", name }),
        uploadFile: async () => "sha1",
        createDeployment: async () => (
          deployed++,
          {
            id: "dpl_1",
            url: "x.vercel.app",
            state: "BUILDING",
            aliases: [],
            meta: {},
          }
        ),
        getDeployment: async () => ({
          id: "dpl_1",
          url: "x.vercel.app",
          state: "READY",
          aliases: ["mvp-app.vercel.app"],
          meta: {},
        }),
        findDeployment: async () => null,
      };
      const { runtime } = await runtimeWith(team(), {
        github: {
          client: github,
          target: async () => ({ owner: "minsun0714", isPrivate: true }),
        },
        vercel: {
          client: vercel,
          owner: async () => "minsun0714",
          probe: async () => 200,
          sleep: async () => {},
          pollIntervalMs: 0,
        },
      });
      const { runId, projectId } = await startReal(3);
      await runtime.drain();

      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "SUCCEEDED", JSON.stringify(run.failure));
      assert.equal(deployed, 1);
      const deployment = await db.deployment.findFirstOrThrow({
        where: { runId },
      });
      assert.equal(deployment.stage, "PUBLISHED");
      assert.equal(deployment.url, "https://mvp-app.vercel.app");
      assert.equal(deployment.commitSha, "abc123");
      const project = await db.project.findUniqueOrThrow({
        where: { id: projectId },
      });
      assert.equal(project.lastGoodDeploymentId, deployment.id);
      const report = await db.verificationReport.findFirstOrThrow({
        where: { runId, deploymentId: deployment.id },
        include: { items: true },
      });
      assert.deepEqual(
        report.items.map((i) => `${i.checkId}:${i.result}`).sort(),
        ["BUILD:PASS", "FINAL_URL:PASS", "SECRETS:PASS", "TESTS:PASS"],
      );

      // 결과 화면: 빌드·배포는 통과, 제품은 요구사항 검증이 없어 미검증
      const result = await (
        await getResult(new Request("http://localhost/api"), {
          params: Promise.resolve({ id: projectId }),
        })
      ).json();
      assert.equal(result.completion.build, "PASS");
      assert.equal(result.completion.deployment, "PASS");
      assert.notEqual(result.completion.product, "COMPLETE");
      assert.equal(
        result.repository.url,
        `https://github.com/minsun0714/${[...repos.keys()][0]}`,
      );
    });

    test("운영 주소가 열리지 않으면 성공으로 보지 않고 마지막 정상 배포를 바꾸지 않는다", async () => {
      const github: GitHubClient = {
        authenticatedLogin: async () => "minsun0714",
        getRepository: async () => null,
        createRepository: async (_o, i) => ({
          id: "8",
          name: i.name,
          htmlUrl: "https://github.com/minsun0714/r",
          defaultBranch: "main",
          description: i.description,
        }),
        recentCommits: async () => [],
        commitFiles: async () => ({ sha: "def456" }),
      };
      const vercel: VercelClient = {
        setProjectEnv: async () => {},
        authenticatedUsername: async () => "minsun0714",
        getProject: async () => null,
        createProject: async (name) => ({ id: "prj_10", name }),
        uploadFile: async () => "sha1",
        createDeployment: async () => ({
          id: "dpl_2",
          url: "y.vercel.app",
          state: "READY",
          aliases: ["y.vercel.app"],
          meta: {},
        }),
        getDeployment: async () => ({
          id: "dpl_2",
          url: "y.vercel.app",
          state: "READY",
          aliases: ["y.vercel.app"],
          meta: {},
        }),
        findDeployment: async () => null,
      };
      const { runtime } = await runtimeWith(team(), {
        github: {
          client: github,
          target: async () => ({ owner: "minsun0714", isPrivate: true }),
        },
        vercel: {
          client: vercel,
          owner: async () => "minsun0714",
          probe: async () => 401,
          sleep: async () => {},
          pollIntervalMs: 0,
        },
      });
      const { runId, projectId } = await startReal(3);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /운영 주소가 열리지 않았어요\(HTTP 401\)/,
      );
      assert.equal(
        (await db.deployment.findFirstOrThrow({ where: { runId } })).stage,
        "FAILED",
      );
      assert.equal(
        (await db.project.findUniqueOrThrow({ where: { id: projectId } }))
          .lastGoodDeploymentId,
        null,
      );
    });

    test("DB가 필요한 앱은 앱 스키마를 만들고, 공개 연결 값을 배포 환경에 넣고, 공개 키 접근까지 확인한다", async () => {
      const pg = new Client({ connectionString });
      await pg.connect();
      await pg.query(
        "do $$ begin if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;",
      );
      let schema = "";
      try {
        const admin: SupabaseAdmin = {
          query: async (_ref, sql) => {
            const r = await pg.query(sql);
            return (Array.isArray(r) ? r[r.length - 1] : r)?.rows ?? [];
          },
          exposedSchemas: async () => ["public"],
          setExposedSchemas: async () => {},
          anonKey: async () => "anon-public-key",
        };
        const envs: Record<string, string>[] = [];
        const github: GitHubClient = {
          authenticatedLogin: async () => "minsun0714",
          getRepository: async () => null,
          createRepository: async (_o, i) => ({
            id: "11",
            name: i.name,
            htmlUrl: "https://github.com/minsun0714/db",
            defaultBranch: "main",
            description: i.description,
          }),
          recentCommits: async () => [],
          commitFiles: async () => ({ sha: "dbsha" }),
        };
        const vercel: VercelClient = {
          setProjectEnv: async (_id, vars) => void envs.push(vars),
          authenticatedUsername: async () => "minsun0714",
          getProject: async () => null,
          createProject: async (name) => ({ id: "prj_db", name }),
          uploadFile: async () => "sha1",
          createDeployment: async () => ({
            id: "dpl_db",
            url: "d.vercel.app",
            state: "READY",
            aliases: ["d.vercel.app"],
            meta: {},
          }),
          getDeployment: async () => ({
            id: "dpl_db",
            url: "d.vercel.app",
            state: "READY",
            aliases: ["d.vercel.app"],
            meta: {},
          }),
          findDeployment: async () => null,
        };
        const probes: string[] = [];
        const model = team({ needsDb: true });
        const { runtime } = await runtimeWith(model, {
          github: {
            client: github,
            target: async () => ({ owner: "minsun0714", isPrivate: true }),
          },
          vercel: {
            client: vercel,
            owner: async () => "minsun0714",
            probe: async () => 200,
            sleep: async () => {},
            pollIntervalMs: 0,
          },
          supabase: {
            admin,
            store: createAppDatabaseStore(db),
            projectRef: "sharedref123",
            owner: async () => "minsun0714",
            probe: async (i) => (
              probes.push(`${i.schema}.${i.table}:${i.anonKey}`),
              200
            ),
          },
        });
        const { runId, projectId } = await startReal(3);
        schema = schemaNameFor(projectId);
        await runtime.drain();

        const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
        assert.equal(run.status, "SUCCEEDED", JSON.stringify(run.failure));
        // 개발자 프롬프트에 Supabase 규칙과 데이터 계획이 들어갔다(브라우저 저장 금지).
        const dev = model.calls.find((c) =>
          systemOf(c).includes("역할: 개발자"),
        )!;
        assert.match(systemOf(dev), /Supabase에 저장합니다/);
        assert.match(systemOf(dev), /"books"/);
        assert.match(systemOf(dev), /localStorage·sessionStorage에 기록 저장/);
        // 실제 테이블이 생기고 anon이 읽을 수 있다.
        await pg.query("begin; set local role anon;");
        await pg.query(`insert into "${schema}"."books" (title) values ('책')`);
        assert.equal(
          (await pg.query(`select title from "${schema}"."books"`)).rows[0]
            .title,
          "책",
        );
        await pg.query("rollback");
        // 배포 환경에는 공개 연결 값만 들어간다(관리 토큰·service role 없음).
        assert.deepEqual(envs, [
          {
            NEXT_PUBLIC_SUPABASE_URL: "https://sharedref123.supabase.co",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-public-key",
            NEXT_PUBLIC_SUPABASE_SCHEMA: schema,
          },
        ]);
        assert.deepEqual(probes, [`${schema}.books:anon-public-key`]);
        const report = await db.verificationReport.findFirstOrThrow({
          where: { runId, deploymentId: { not: null } },
          include: { items: true },
        });
        assert.equal(
          report.items.find((i) => i.checkId === "DB_ACCESS")?.result,
          "PASS",
        );
        const resource = await db.externalResource.findFirstOrThrow({
          where: { projectId, kind: "DATABASE" },
          include: { migrations: true },
        });
        assert.equal(resource.externalId, `sharedref123:${schema}`);
        assert.equal(resource.migrations.length, 1);
      } finally {
        if (schema) await pg.query(`drop schema if exists "${schema}" cascade`);
        if (schema)
          await pg
            .query(
              `delete from "mvpfactory_meta"."migrations" where schema_name = $1`,
              [schema],
            )
            .catch(() => undefined);
        await pg.end();
      }
    });

    test("인증 필수 계획은 개발자 호출과 소스 생성 전에 중단한다", async () => {
      const model = team({ needsAuth: true });
      const { runtime } = await runtimeWith(model);
      const { runId } = await startReal(3, `독서 기록. ${AUTH_REQUEST}.`);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        new RegExp(`대표님 입력의 "${AUTH_REQUEST}"[\\s\\S]*현재 생성 범위 밖`),
      );
      assert.equal(
        model.calls.filter((c) => systemOf(c).includes("역할: 기획자")).length,
        1,
      );
      assert.equal(
        model.calls.some((c) => systemOf(c).includes("역할: 개발자")),
        false,
      );
      assert.equal(
        await db.artifact.count({
          where: { runId, type: "IMPLEMENTATION_RESULT" },
        }),
        0,
      );
    });

    test("DB가 필요한 앱인데 Supabase가 준비되지 않았으면 코드 생성 전에 멈춘다(브라우저 저장으로 대신하지 않는다)", async () => {
      const model = team({ needsDb: true });
      const github: GitHubClient = {
        authenticatedLogin: async () => "x",
        getRepository: async () => null,
        createRepository: async () => {
          throw new Error("no");
        },
        recentCommits: async () => [],
        commitFiles: async () => {
          throw new Error("no");
        },
      };
      const { runtime } = await runtimeWith(model, {
        github: {
          client: github,
          target: async () => ({ owner: "x", isPrivate: true }),
        },
      });
      const { runId } = await startReal(3);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.equal(run.status, "FAILED");
      assert.match(
        (run.failure as { message: string }).message,
        /DB가 필요한 앱인데 Supabase 준비가 끝나지 않아 개발을 시작하지 않았어요/,
      );
      assert.ok(
        !model.calls.some((c) => systemOf(c).includes("역할: 개발자")),
        "개발자 모델을 부르지 않는다",
      );
    });

    test("GitHub 연결 설정이 없으면 올리지 않고 이유를 알린다", async () => {
      let calls = 0;
      const client = new Proxy(
        {},
        {
          get: () => async () => {
            calls += 1;
            throw new Error("호출되면 안 된다");
          },
        },
      ) as GitHubClient;
      const { runtime } = await runtimeWith(team(), {
        github: { client, target: async () => null },
      });
      const { runId } = await startReal(3);
      await runtime.drain();
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
      assert.match(
        (run.failure as { message: string }).message,
        /GitHub 연결 설정이 없어/,
      );
      assert.equal(calls, 0);
    });
  },
);
