import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { OutcomeUnknownError } from "@/application/external-operations";
import {
  PublishBlockedError,
  publishSourceToGitHub,
  type GitHubClient,
  type GitHubRepository,
  type PublishInput,
} from "@/application/github";
import { repositoryMarker, repositoryNameFor } from "@/domain/repository";
import { db, WORKSPACE_ID } from "@/lib/db";
import {
  createGitHubClient,
  GitHubApiError,
} from "@/infrastructure/github/github-client";
import { createExternalOperationStore } from "@/infrastructure/prisma/external-operation-store";

const TOKEN = "ghp_secret_token_value_123456";
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
        name: "Water Tracker",
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
after(() => db.$disconnect());
// 테스트마다 원장을 비운다(각 테스트가 자기 모의 GitHub와 짝이 맞아야 한다).
beforeEach(() => db.externalOperation.deleteMany({ where: { projectId } }));

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  projectId,
  runId,
  projectName: "Water Tracker",
  owner: "minsun0714",
  isPrivate: true,
  sourceDigest: "a".repeat(64),
  secrets: [TOKEN],
  files: [
    { path: "package.json", content: "{}" },
    { path: "app/page.tsx", content: "export default 1" },
  ],
  ...over,
});

/** 메모리 안의 GitHub. 호출 기록으로 "몇 번 외부에 요청했는지"를 센다. */
function fakeGitHub(
  opts: { login?: string; failCommitOnce?: "unknown" | null } = {},
) {
  const calls: string[] = [];
  const repos = new Map<string, GitHubRepository>();
  const commits: { sha: string; message: string }[] = [];
  let failOnce = opts.failCommitOnce ?? null;
  const client: GitHubClient = {
    async authenticatedLogin() {
      calls.push("login");
      return opts.login ?? "minsun0714";
    },
    async getRepository(_o, name) {
      calls.push("getRepository");
      return repos.get(name) ?? null;
    },
    async createRepository(_o, i) {
      calls.push("createRepository");
      const repo = {
        id: String(repos.size + 100),
        name: i.name,
        htmlUrl: `https://github.com/minsun0714/${i.name}`,
        defaultBranch: "main",
        description: i.description,
      };
      repos.set(i.name, repo);
      return repo;
    },
    async recentCommits() {
      calls.push("recentCommits");
      return [...commits].reverse();
    },
    async commitFiles(_o, _n, _b, files, message) {
      calls.push("commitFiles");
      const sha = `sha${commits.length + 1}`;
      // 반영은 됐는데 응답만 못 받은 경우를 흉내 낸다.
      commits.push({ sha, message: `${message} (${files.length} files)` });
      if (failOnce === "unknown") {
        failOnce = null;
        throw new OutcomeUnknownError();
      }
      return { sha };
    },
  };
  return {
    client,
    calls,
    repos,
    commits,
    count: (n: string) => calls.filter((c) => c === n).length,
  };
}

describe("GitHub 발행(원장 사용)", () => {
  test("저장소를 만들고 커밋하며, 같은 소스를 다시 발행해도 외부 요청을 반복하지 않는다", async () => {
    const gh = fakeGitHub();
    const first = await publishSourceToGitHub(
      { client: gh.client, ledger },
      input(),
    );
    assert.equal(
      first.repositoryName,
      repositoryNameFor("Water Tracker", projectId),
    );
    assert.match(first.repositoryName, /^mvp-water-tracker-[a-z0-9]{8}$/);
    assert.equal(first.reusedRepository, false);
    assert.equal(first.reusedCommit, false);
    assert.equal(gh.count("createRepository"), 1);
    assert.equal(gh.count("commitFiles"), 1);
    assert.ok(
      gh.repos
        .get(first.repositoryName)!
        .description!.includes(repositoryMarker(projectId)),
    );

    const again = await publishSourceToGitHub(
      { client: gh.client, ledger },
      input(),
    );
    assert.equal(again.commitSha, first.commitSha);
    assert.equal(again.reusedRepository && again.reusedCommit, true);
    assert.equal(
      gh.count("createRepository"),
      1,
      "저장소를 다시 만들지 않는다",
    );
    assert.equal(gh.count("commitFiles"), 1, "커밋을 다시 올리지 않는다");
  });

  test("새 소스(수정)는 같은 저장소에 새 커밋으로 올린다", async () => {
    const gh = fakeGitHub();
    await publishSourceToGitHub({ client: gh.client, ledger }, input());
    const revised = await publishSourceToGitHub(
      { client: gh.client, ledger },
      input({ sourceDigest: "b".repeat(64) }),
    );
    assert.equal(revised.reusedRepository, true);
    assert.equal(revised.reusedCommit, false);
    assert.equal(
      gh.count("createRepository"),
      1,
      "저장소는 처음 한 번만 만든다",
    );
    assert.equal(gh.count("commitFiles"), 2, "소스가 바뀌면 새 커밋");
  });

  test("커밋 결과가 불명확하면 단정하지 않고, 다시 시도할 때 조회로 확인해 중복 커밋을 만들지 않는다", async () => {
    const gh = fakeGitHub({ failCommitOnce: "unknown" });
    const digest = "c".repeat(64);
    await assert.rejects(
      publishSourceToGitHub(
        { client: gh.client, ledger },
        input({ sourceDigest: digest }),
      ),
      OutcomeUnknownError,
    );
    const op = await db.externalOperation.findUniqueOrThrow({
      where: { operationKey: `github:commit:${runId}:${digest}` },
    });
    assert.equal(op.status, "UNKNOWN");

    const retried = await publishSourceToGitHub(
      { client: gh.client, ledger },
      input({ sourceDigest: digest }),
    );
    assert.equal(retried.commitSha, "sha1", "이미 반영된 커밋을 조회로 찾는다");
    assert.equal(gh.count("commitFiles"), 1, "다시 커밋하지 않는다");
  });

  test("계정이 다르거나 비밀값이 있으면 아무 외부 변경도 하지 않는다", async () => {
    const other = fakeGitHub({ login: "someone-else" });
    await assert.rejects(
      publishSourceToGitHub(
        { client: other.client, ledger },
        input({ sourceDigest: "d".repeat(64) }),
      ),
      (e: unknown) =>
        e instanceof PublishBlockedError && /계정/.test(e.message),
    );
    assert.equal(
      other.count("createRepository") + other.count("commitFiles"),
      0,
    );

    const gh = fakeGitHub();
    for (const files of [
      [
        { path: "package.json", content: "{}" },
        { path: ".env", content: "A=1" },
      ],
      [
        { path: "package.json", content: "{}" },
        { path: "src/a.ts", content: `const t = "${TOKEN}"` },
      ],
    ])
      await assert.rejects(
        publishSourceToGitHub(
          { client: gh.client, ledger },
          input({ files, sourceDigest: "e".repeat(64) }),
        ),
        PublishBlockedError,
      );
    assert.deepEqual(gh.calls, [], "검사에 걸리면 GitHub를 부르지도 않는다");
  });

  test("같은 이름의 남의 저장소는 사용하지 않는다", async () => {
    const gh = fakeGitHub();
    const name = repositoryNameFor("Water Tracker", projectId);
    // 원장에는 아직 없고 GitHub에는 같은 이름이 이미 있는 상황(식별자 없음)
    await db.externalOperation.deleteMany({
      where: { operationKey: `github:repo:${projectId}` },
    });
    gh.repos.set(name, {
      id: "999",
      name,
      htmlUrl: "https://github.com/x/y",
      defaultBranch: "main",
      description: "누군가의 저장소",
    });
    gh.client.createRepository = async () => {
      throw new GitHubApiError(422, "name already exists");
    };
    await assert.rejects(
      publishSourceToGitHub(
        { client: gh.client, ledger },
        input({ sourceDigest: "f".repeat(64) }),
      ),
      (e: unknown) => e instanceof GitHubApiError,
    );
    // 실패가 기록된 뒤 다시 시도하면 조회로 확인하고, 식별자가 없으니 멈춘다.
    await assert.rejects(
      publishSourceToGitHub(
        { client: gh.client, ledger },
        input({ sourceDigest: "f".repeat(64) }),
      ),
      (e: unknown) =>
        e instanceof PublishBlockedError &&
        /이 프로젝트가 만든 것이 아니라/.test(e.message),
    );
    assert.equal(gh.count("commitFiles"), 0);
  });
});

describe("GitHub REST 클라이언트", () => {
  type Hit = {
    method: string;
    url: string;
    body: unknown;
    headers: Record<string, string>;
  };
  function server(handler: (hit: Hit) => Response) {
    const hits: Hit[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      const hit = {
        method: init.method!,
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: init.headers as Record<string, string>,
      };
      hits.push(hit);
      return handler(hit);
    }) as unknown as typeof fetch;
    return {
      hits,
      client: createGitHubClient({ token: TOKEN, fetch: fetchFn }),
    };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  test("파일 전체를 blob→tree→commit→ref 순서로 올리고 강제 갱신하지 않는다", async () => {
    const { hits, client } = server((h) => {
      if (h.url.endsWith("/git/ref/heads/main"))
        return json({ object: { sha: "head1" } });
      if (h.url.endsWith("/git/blobs"))
        return json({ sha: `blob-${(h.body as { content: string }).content}` });
      if (h.url.endsWith("/git/trees")) return json({ sha: "tree1" });
      if (h.url.endsWith("/git/commits")) return json({ sha: "commit1" });
      if (h.method === "PATCH") return json({});
      return json({}, 500);
    });
    const result = await client.commitFiles(
      "minsun0714",
      "repo",
      "main",
      [{ path: "a.txt", content: "안녕" }],
      "msg",
    );
    assert.deepEqual(result, { sha: "commit1" });
    assert.deepEqual(
      hits.map(
        (h) =>
          `${h.method} ${new URL(h.url).pathname.split("/").slice(4).join("/")}`,
      ),
      [
        "GET git/ref/heads/main",
        "POST git/blobs",
        "POST git/trees",
        "POST git/commits",
        "PATCH git/refs/heads/main",
      ],
    );
    const tree = hits[2].body as {
      tree: { path: string; sha: string }[];
      base_tree?: string;
    };
    assert.equal(tree.base_tree, undefined, "base_tree 없이 파일 목록 그대로");
    assert.equal(tree.tree[0].path, "a.txt");
    assert.deepEqual(hits[3].body, {
      message: "msg",
      tree: "tree1",
      parents: ["head1"],
    });
    assert.deepEqual(hits[4].body, { sha: "commit1", force: false });
    assert.equal(
      Buffer.from(
        (hits[1].body as { content: string }).content,
        "base64",
      ).toString(),
      "안녕",
    );
  });

  test("저장소 생성은 비공개 여부와 첫 커밋 옵션을 보내고, 토큰은 헤더로만 보낸다", async () => {
    const { hits, client } = server(() =>
      json(
        {
          id: 7,
          name: "n",
          html_url: "https://github.com/o/n",
          default_branch: "main",
          description: "d",
        },
        201,
      ),
    );
    const repo = await client.createRepository("o", {
      name: "n",
      description: "d",
      isPrivate: true,
    });
    assert.equal(repo.id, "7");
    const body = hits[0].body as Record<string, unknown>;
    assert.equal(body.private, true);
    assert.equal(body.auto_init, true);
    assert.equal(hits[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(body).includes(TOKEN));
  });

  test("없는 저장소는 null, 오류는 토큰 없이 알리고, 변경 요청의 연결 끊김은 결과 불명확이다", async () => {
    const missing = server(() => json({ message: "Not Found" }, 404));
    assert.equal(await missing.client.getRepository("o", "n"), null);
    const denied = server(() =>
      json({ message: `Bad credentials ${TOKEN}`.slice(0, 40) }, 401),
    );
    await assert.rejects(
      denied.client.authenticatedLogin(),
      (e: unknown) =>
        e instanceof GitHubApiError &&
        e.status === 401 &&
        !e.message.includes(TOKEN),
    );
    const down = createGitHubClient({
      token: TOKEN,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await assert.rejects(
      down.createRepository("o", {
        name: "n",
        description: "d",
        isPrivate: true,
      }),
      OutcomeUnknownError,
    );
    await assert.rejects(
      down.getRepository("o", "n"),
      (e: unknown) => e instanceof GitHubApiError && e.status === 0,
    );
  });
});
