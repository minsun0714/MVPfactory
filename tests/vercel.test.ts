import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { OutcomeUnknownError } from "@/application/external-operations";
import {
  DIGEST_META,
  DeployBlockedError,
  DeployFailedError,
  deployToVercel,
  type DeployInput,
  type VercelClient,
  type VercelDeployment,
} from "@/application/vercel";
import { db, WORKSPACE_ID } from "@/lib/db";
import { createExternalOperationStore } from "@/infrastructure/prisma/external-operation-store";
import {
  createVercelClient,
  VercelApiError,
} from "@/infrastructure/vercel/vercel-client";

const TOKEN = "vercel_secret_token_value_123";
const ledger = createExternalOperationStore(db);
let projectId = "";
let runId = "";

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
        name: "배포",
        idea: "x",
        ceoLevel: "DELEGATE",
      },
    })
  ).id;
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
  runId = (
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
});
beforeEach(() => db.externalOperation.deleteMany({ where: { projectId } }));
after(() => db.$disconnect());

const input = (over: Partial<DeployInput> = {}): DeployInput => ({
  projectId,
  runId,
  projectName: "mvp-app-abc12345",
  owner: "minsun0714",
  sourceDigest: "a".repeat(64),
  commitSha: "c0ffee",
  files: [
    { path: "package.json", content: "{}" },
    { path: "app/page.tsx", content: "x" },
  ],
  ...over,
});

function fakeVercel(
  opts: {
    finalState?: "READY" | "ERROR";
    unknownOnce?: boolean;
    username?: string;
  } = {},
) {
  const calls: string[] = [];
  const deployments = new Map<string, VercelDeployment>();
  let polls = 0;
  let unknownOnce = opts.unknownOnce ?? false;
  const client: VercelClient = {
    setProjectEnv: async () => {},
    authenticatedUsername: async () => (
      calls.push("user"),
      opts.username ?? "minsun0714"
    ),
    getProject: async (name) => (
      calls.push("getProject"),
      calls.includes("createProject") ? { id: "prj_1", name } : null
    ),
    createProject: async (name) => (
      calls.push("createProject"),
      { id: "prj_1", name }
    ),
    uploadFile: async (content) => (
      calls.push("upload"),
      createHash("sha1").update(content).digest("hex")
    ),
    async createDeployment(i) {
      calls.push("createDeployment");
      const d: VercelDeployment = {
        id: `dpl_${deployments.size + 1}`,
        url: "x.vercel.app",
        state: "QUEUED",
        aliases: [],
        meta: i.meta,
      };
      deployments.set(d.id, d);
      if (unknownOnce) {
        unknownOnce = false;
        throw new OutcomeUnknownError();
      }
      return d;
    },
    async getDeployment(id) {
      calls.push("getDeployment");
      polls += 1;
      const d = deployments.get(id)!;
      if (polls >= 2)
        Object.assign(d, {
          state: opts.finalState ?? "READY",
          aliases:
            opts.finalState === "ERROR" ? [] : ["mvp-app-abc12345.vercel.app"],
        });
      return { ...d };
    },
    findDeployment: async (_p, key, value) => (
      calls.push("findDeployment"),
      [...deployments.values()].find((d) => d.meta[key] === value) ?? null
    ),
  };
  return {
    client,
    calls,
    deployments,
    count: (n: string) => calls.filter((c) => c === n).length,
  };
}
const deps = (
  client: VercelClient,
  probe: (url: string) => Promise<number | null> = async () => 200,
) => ({ client, ledger, probe, sleep: async () => {}, pollIntervalMs: 0 });

describe("Vercel 배포(원장 사용)", () => {
  test("프로젝트를 만들고 배포해 READY와 운영 주소 응답까지 확인하며, 같은 소스는 다시 배포하지 않는다", async () => {
    const v = fakeVercel();
    const probed: string[] = [];
    const result = await deployToVercel(
      deps(v.client, async (url) => (probed.push(url), 200)),
      input(),
    );
    assert.equal(result.finalUrl, "https://mvp-app-abc12345.vercel.app");
    assert.equal(result.finalUrlStatus, 200);
    assert.deepEqual(probed, ["https://mvp-app-abc12345.vercel.app"]);
    assert.equal(v.count("upload"), 2);
    const meta = v.deployments.get(result.deploymentId)!.meta;
    assert.equal(meta[DIGEST_META], "a".repeat(64));

    const again = await deployToVercel(deps(v.client), input());
    assert.equal(again.reusedDeployment, true);
    assert.equal(again.deploymentId, result.deploymentId);
    assert.equal(v.count("createProject"), 1);
    assert.equal(v.count("createDeployment"), 1);
  });

  test("빌드가 실패하면 실패로 알리고 운영 주소를 확인하지 않는다", async () => {
    const v = fakeVercel({ finalState: "ERROR" });
    let probed = 0;
    await assert.rejects(
      deployToVercel(
        deps(v.client, async () => (probed++, 200)),
        input(),
      ),
      (e: unknown) =>
        e instanceof DeployFailedError &&
        /마지막 정상 배포는 그대로/.test(e.message),
    );
    assert.equal(probed, 0);
  });

  test("운영 주소가 200이 아니면 주소를 결과로 인정하지 않는다", async () => {
    const result = await deployToVercel(
      deps(fakeVercel().client, async () => 401),
      input(),
    );
    assert.equal(result.finalUrl, null);
    assert.equal(result.finalUrlStatus, 401);
  });

  test("배포 요청 결과가 불명확하면 다시 시도할 때 meta로 찾아 중복 배포하지 않는다", async () => {
    const v = fakeVercel({ unknownOnce: true });
    await assert.rejects(
      deployToVercel(deps(v.client), input()),
      OutcomeUnknownError,
    );
    const result = await deployToVercel(deps(v.client), input());
    assert.equal(result.reusedDeployment, true);
    assert.equal(v.count("createDeployment"), 1);
    assert.equal(v.count("findDeployment"), 1);
  });

  test("토큰 계정이 설정과 다르면 아무것도 만들지 않는다", async () => {
    const v = fakeVercel({ username: "someone" });
    await assert.rejects(
      deployToVercel(deps(v.client), input()),
      DeployBlockedError,
    );
    assert.deepEqual(v.calls, ["user"]);
  });
});

describe("Vercel REST 클라이언트", () => {
  type Hit = {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: BodyInit | null | undefined;
  };
  function server(handler: (hit: Hit) => Response) {
    const hits: Hit[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      const hit = {
        method: init.method!,
        url,
        headers: init.headers as Record<string, string>,
        body: init.body,
      };
      hits.push(hit);
      return handler(hit);
    }) as unknown as typeof fetch;
    return {
      hits,
      client: createVercelClient({ token: TOKEN, fetch: fetchFn }),
    };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  test("파일은 sha1 digest 헤더와 원본 바이트로 올린다", async () => {
    const { hits, client } = server(() => json({}));
    const sha = await client.uploadFile(Buffer.from("안녕"));
    assert.equal(
      sha,
      createHash("sha1").update(Buffer.from("안녕")).digest("hex"),
    );
    assert.equal(hits[0].headers["x-vercel-digest"], sha);
    assert.equal(Buffer.from(hits[0].body as Uint8Array).toString(), "안녕");
    assert.equal(hits[0].headers.authorization, `Bearer ${TOKEN}`);
  });

  test("배포 요청은 운영 대상·파일 목록·meta를 보내고 응답을 변환한다", async () => {
    const { hits, client } = server(() =>
      json({
        id: "dpl_9",
        url: "a.vercel.app",
        readyState: "BUILDING",
        alias: [],
      }),
    );
    const d = await client.createDeployment({
      projectName: "p",
      files: [{ file: "a", sha: "s", size: 1 }],
      meta: { k: "v" },
    });
    assert.deepEqual(d, {
      id: "dpl_9",
      url: "a.vercel.app",
      state: "BUILDING",
      aliases: [],
      meta: {},
    });
    const body = JSON.parse(hits[0].body as string);
    assert.equal(body.target, "production");
    assert.equal(body.project, "p");
    assert.deepEqual(body.files, [{ file: "a", sha: "s", size: 1 }]);
    assert.deepEqual(body.meta, { k: "v" });
  });

  test("목록 응답(uid·state)도 같은 형태로 읽고 meta로 찾는다", async () => {
    const { client } = server(() =>
      json({
        deployments: [
          { uid: "dpl_1", url: "u", state: "READY", meta: { k: "x" } },
          { uid: "dpl_2", url: "u2", state: "ERROR", meta: { k: "v" } },
        ],
      }),
    );
    const hit = await client.findDeployment("prj", "k", "v");
    assert.equal(hit?.id, "dpl_2");
    assert.equal(hit?.state, "ERROR");
  });

  test("없는 프로젝트는 null, 오류에는 토큰이 없고, 변경 요청의 연결 끊김은 결과 불명확이다", async () => {
    assert.equal(
      await server(() =>
        json({ error: { message: "nf" } }, 404),
      ).client.getProject("p"),
      null,
    );
    await assert.rejects(
      server(() =>
        json({ error: { message: "forbidden" } }, 403),
      ).client.authenticatedUsername(),
      (e: unknown) =>
        e instanceof VercelApiError &&
        e.status === 403 &&
        !e.message.includes(TOKEN),
    );
    const down = createVercelClient({
      token: TOKEN,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await assert.rejects(down.createProject("p"), OutcomeUnknownError);
    await assert.rejects(
      down.getProject("p"),
      (e: unknown) => e instanceof VercelApiError && e.status === 0,
    );
  });
});
