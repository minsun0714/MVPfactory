import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { GET as getResult } from "@/app/api/projects/[id]/result/route";
import { GET as getVerification } from "@/app/api/runs/[id]/verification/route";
import {
  verifyBuild,
  type BuildVerificationDeps,
} from "@/application/build-verification";
import type { Sandbox } from "@/application/sandbox";
import { createRedactor } from "@/domain/secrets";
import type { SourceFileInput } from "@/domain/sandbox";
import { db, WORKSPACE_ID } from "@/lib/db";
import { createVerificationStore } from "@/infrastructure/prisma/verification-store";
import { createDockerSandbox } from "@/infrastructure/sandbox/docker-sandbox";
import { dockerSkipReason } from "@tests/helpers/docker";

const skip = dockerSkipReason();
const SECRET = "factory-secret-token-abcdef123456";
let projectId = "";

function sandbox(): Sandbox {
  return createDockerSandbox({ image: "node:22-slim", namespace: "test" });
}

/** 의존성이 없는 작은 Node 프로젝트. 설치에 외부 통신이 필요 없어 오프라인에서도 돈다. */
function sample(
  over: {
    build?: string;
    test?: string | null;
    extra?: SourceFileInput[];
    omit?: string[];
  } = {},
): SourceFileInput[] {
  const scripts: Record<string, string> = { build: "node build.js" };
  if (over.test !== null) scripts.test = "node --test";
  const files: SourceFileInput[] = [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "sample",
        version: "1.0.0",
        private: true,
        scripts,
      }),
    },
    {
      path: "package-lock.json",
      content: JSON.stringify({
        name: "sample",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "sample", version: "1.0.0" } },
      }),
    },
    {
      path: "build.js",
      content:
        over.build ??
        "require('fs').mkdirSync('dist',{recursive:true}); require('fs').writeFileSync('dist/ok.txt','built')",
    },
    {
      path: "sample.test.js",
      content:
        over.test ??
        "require('node:test')('덧셈', () => require('node:assert').equal(1 + 1, 2))",
    },
    ...(over.extra ?? []),
  ];
  return files.filter(
    (file) =>
      !over.omit?.includes(file.path) &&
      !(over.test === null && file.path === "sample.test.js"),
  );
}

async function newRun() {
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
  return (
    await db.run.create({
      data: {
        projectId,
        type: "INITIAL",
        mode: "REAL",
        status: "RUNNING",
        ceoLevel: "DELEGATE",
        projectGeneration: 1,
        workflowVersion: "t",
        promptVersion: "t",
        modelConfig: {},
        limits: {},
        threadId: randomUUID(),
      },
    })
  ).id;
}

/** 샌드박스를 몇 번 열었는지 센다. 열기 전에 멈춰야 하는 경우를 확인한다. */
function counting(inner: Sandbox) {
  const state = { opened: 0 };
  return {
    state,
    sandbox: {
      open: (o: { runId: string }) => (state.opened++, inner.open(o)),
      cleanupStale: inner.cleanupStale,
    } as Sandbox,
  };
}

const deps = (
  over: Partial<BuildVerificationDeps> = {},
): BuildVerificationDeps => ({
  sandbox: sandbox(),
  store: createVerificationStore(db),
  redact: createRedactor([SECRET]),
  secrets: [SECRET],
  ...over,
});
const result = (items: { checkId: string; result: string }[], id: string) =>
  items.find((item) => item.checkId === id)?.result;

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
        name: "검증",
        idea: "x",
        ceoLevel: "DELEGATE",
      },
    })
  ).id;
});
after(() => db.$disconnect());

describe("빌드·테스트 검증(실제 Docker 샌드박스)", { skip }, () => {
  test("설치·빌드·테스트가 통과하면 통과로 기록하지만 제품 완료로 보지 않는다", async () => {
    const runId = await newRun();
    const outcome = await verifyBuild(deps(), {
      runId,
      specVersion: 1,
      files: sample(),
    });
    assert.equal(result(outcome.items, "SECRETS"), "PASS");
    assert.equal(result(outcome.items, "BUILD"), "PASS");
    assert.equal(result(outcome.items, "TESTS"), "PASS");

    const report = await db.verificationReport.findUniqueOrThrow({
      where: { id: outcome.reportId },
      include: { items: true },
    });
    assert.equal(report.sourceDigest, outcome.sourceDigest);
    assert.equal(report.harnessVersion, "docker-sandbox-0.1");
    assert.equal(report.specVersion, 1);
    assert.equal(report.items.length, 3);
    const event = await db.runEvent.findFirstOrThrow({
      where: { runId, type: "verification.recorded" },
    });
    assert.equal((event.data as { counts: { PASS: number } }).counts.PASS, 3);

    // 빌드 통과는 배포 성공도, 제품 완료도 아니다.
    const final = await getResult(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: projectId }),
    });
    const body = await final.json();
    assert.equal(body.completion.build, "PASS");
    assert.equal(body.completion.deployment, "NOT_RUN");
    assert.equal(body.completion.product, "NOT_VERIFIED");
    const api = await getVerification(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: runId }),
    });
    assert.equal(api.status, 200);
  });

  test("빌드가 실패하면 실제 오류 출력을 증거로 남기고 테스트는 실행하지 않는다", async () => {
    const runId = await newRun();
    const outcome = await verifyBuild(deps(), {
      runId,
      specVersion: 1,
      files: sample({
        build: "console.error('빌드 오류: 의도한 실패'); process.exit(1)",
      }),
    });
    assert.equal(result(outcome.items, "BUILD"), "FAIL");
    assert.equal(result(outcome.items, "TESTS"), "NOT_RUN");
    const build = outcome.items.find((item) => item.checkId === "BUILD")!;
    assert.match(build.evidence!, /빌드 실패/);
    assert.match(build.evidence!, /빌드 오류: 의도한 실패/);
    assert.match(build.evidence!, /종료 코드 1/);
  });

  test("테스트가 실패하면 빌드는 통과여도 제품은 미완료로 판단한다", async () => {
    const runId = await newRun();
    const outcome = await verifyBuild(deps(), {
      runId,
      specVersion: 1,
      files: sample({
        test: "require('node:test')('틀린 덧셈', () => require('node:assert').equal(1 + 1, 3))",
      }),
    });
    assert.equal(result(outcome.items, "BUILD"), "PASS");
    assert.equal(result(outcome.items, "TESTS"), "FAIL");
    assert.match(
      outcome.items.find((item) => item.checkId === "TESTS")!.evidence!,
      /종료 코드 1/,
    );
    const body = await (
      await getResult(new Request("http://localhost/api"), {
        params: Promise.resolve({ id: projectId }),
      })
    ).json();
    assert.equal(body.completion.product, "INCOMPLETE");
  });

  test("테스트 스크립트가 없으면 통과로 꾸미지 않고 미실행으로 남긴다", async () => {
    const outcome = await verifyBuild(deps(), {
      runId: await newRun(),
      specVersion: 1,
      files: sample({ test: null }),
    });
    assert.equal(result(outcome.items, "BUILD"), "PASS");
    assert.equal(result(outcome.items, "TESTS"), "NOT_RUN");
    assert.match(
      outcome.items.find((item) => item.checkId === "TESTS")!.evidence!,
      /test 스크립트가 없어/,
    );
  });

  test("필수 파일이 없으면 샌드박스를 열지 않고 실패로 기록한다", async () => {
    for (const [omit, message] of [
      [["package-lock.json"], /package-lock\.json이 없어/],
      [["package.json"], /package\.json이 없습니다/],
    ] as const) {
      const { state, sandbox: counted } = counting(sandbox());
      const outcome = await verifyBuild(deps({ sandbox: counted }), {
        runId: await newRun(),
        specVersion: 1,
        files: sample({ omit: [...omit] }),
      });
      assert.equal(result(outcome.items, "BUILD"), "FAIL");
      assert.match(
        outcome.items.find((item) => item.checkId === "BUILD")!.evidence!,
        message,
      );
      assert.equal(state.opened, 0);
    }
    const noBuildScript = counting(sandbox());
    const files = sample().map((file) =>
      file.path === "package.json"
        ? {
            path: file.path,
            content: JSON.stringify({ name: "x", scripts: {} }),
          }
        : file,
    );
    const outcome = await verifyBuild(
      deps({ sandbox: noBuildScript.sandbox }),
      { runId: await newRun(), specVersion: 1, files },
    );
    assert.match(
      outcome.items.find((item) => item.checkId === "BUILD")!.evidence!,
      /build 스크립트가 없습니다/,
    );
    assert.equal(noBuildScript.state.opened, 0);
  });

  test("소스에 비밀값이나 .env가 있으면 샌드박스에 넣기 전에 멈추고 값은 기록하지 않는다", async () => {
    const { state, sandbox: counted } = counting(sandbox());
    const runId = await newRun();
    const files = sample({
      extra: [
        {
          path: "src/config.js",
          content: `module.exports = { token: "${SECRET}" }`,
        },
        { path: ".env", content: "A=1" },
        {
          path: "keys/id_rsa",
          content: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc",
        },
      ],
    });
    const outcome = await verifyBuild(deps({ sandbox: counted }), {
      runId,
      specVersion: 1,
      files,
    });
    assert.equal(state.opened, 0, "샌드박스를 열지 않는다");
    assert.equal(result(outcome.items, "SECRETS"), "FAIL");
    assert.equal(result(outcome.items, "BUILD"), "NOT_RUN");
    const evidence = outcome.items.find(
      (item) => item.checkId === "SECRETS",
    )!.evidence!;
    assert.match(evidence, /src\/config\.js/);
    assert.match(evidence, /\.env: 환경 파일/);
    assert.match(evidence, /keys\/id_rsa: 개인 키/);
    const stored = JSON.stringify(
      await db.verificationItem.findMany({
        where: { reportId: outcome.reportId },
      }),
    );
    assert.ok(!stored.includes(SECRET), "비밀값이 DB에 남으면 안 된다");
  });

  test("빌드 출력에 비밀값이 섞여도 보고서에는 가려서 남긴다", async () => {
    const outcome = await verifyBuild(deps(), {
      runId: await newRun(),
      specVersion: 1,
      files: sample({
        build: `console.error('실패 ' + 'factory-secret-token-' + 'abcdef123456'); process.exit(1)`,
      }),
    });
    const evidence = outcome.items.find(
      (item) => item.checkId === "BUILD",
    )!.evidence!;
    assert.ok(!evidence.includes(SECRET));
    assert.match(evidence, /\[비밀값\]/);
  });

  test("무한 루프 빌드는 시간 초과로 끝내고 컨테이너를 남기지 않는다", async () => {
    const outcome = await verifyBuild(
      deps({ timeouts: { installMs: 60_000, buildMs: 2000, testMs: 60_000 } }),
      {
        runId: await newRun(),
        specVersion: 1,
        files: sample({ build: "for(;;){}" }),
      },
    );
    assert.equal(result(outcome.items, "BUILD"), "FAIL");
    assert.match(
      outcome.items.find((item) => item.checkId === "BUILD")!.evidence!,
      /시간 초과/,
    );
  });
});
