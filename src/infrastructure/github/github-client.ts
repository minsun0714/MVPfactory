/**
 * GitHub REST API로 만든 `GitHubClient`. 토큰은 요청 헤더에만 쓰고 오류 메시지·로그에 넣지 않는다.
 * 변경 요청에서 응답을 받지 못하면 `OutcomeUnknownError`를 던져 호출자가 성공·실패를 단정하지 않게 한다.
 */
import type { GitHubClient, GitHubRepository } from "@/application/github";
import { OutcomeUnknownError } from "@/application/external-operations";
import { toBytes } from "@/domain/sandbox";

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function createGitHubClient(options: {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): GitHubClient {
  if (!options.token.trim()) throw new Error("GITHUB_TOKEN이 비어 있습니다.");
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");

  /** 읽기 요청은 실패하면 그대로 오류, 변경 요청은 응답이 없으면 결과 불명확으로 던진다. */
  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    accept404 = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "mvp-factory",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (method === "GET")
        throw new GitHubApiError(0, "GitHub에 연결하지 못했어요.");
      throw new OutcomeUnknownError("GitHub 요청의 결과를 확인하지 못했어요.");
    }
    if (response.status === 404 && accept404) return null;
    const text = await response.text();
    if (!response.ok) {
      let message = "";
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? "";
      } catch {
        /* 본문이 JSON이 아니면 상태 코드만 쓴다 */
      }
      throw new GitHubApiError(
        response.status,
        `GitHub 요청 실패(HTTP ${response.status})${message ? `: ${message.slice(0, 160)}` : ""}`,
      );
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  const required = async <T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ) => (await call<T>(method, path, body)) as T;

  type RepoBody = {
    id: number;
    name: string;
    html_url: string;
    default_branch: string;
    description: string | null;
  };
  const toRepo = (r: RepoBody): GitHubRepository => ({
    id: String(r.id),
    name: r.name,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    description: r.description,
  });
  const enc = encodeURIComponent;

  return {
    async authenticatedLogin() {
      return (await required<{ login: string }>("GET", "/user")).login;
    },

    async getRepository(owner, name) {
      const repo = await call<RepoBody>(
        "GET",
        `/repos/${enc(owner)}/${enc(name)}`,
        undefined,
        true,
      );
      return repo ? toRepo(repo) : null;
    },

    async createRepository(_owner, input) {
      return toRepo(
        await required<RepoBody>("POST", "/user/repos", {
          name: input.name,
          description: input.description,
          private: input.isPrivate,
          // 첫 커밋이 있어야 Git Data API로 파일을 올릴 수 있다.
          auto_init: true,
          has_issues: false,
          has_wiki: false,
        }),
      );
    },

    async recentCommits(owner, name, branch) {
      const list = await required<
        { sha: string; commit: { message: string } }[]
      >(
        "GET",
        `/repos/${enc(owner)}/${enc(name)}/commits?sha=${enc(branch)}&per_page=30`,
      );
      return list.map((c) => ({ sha: c.sha, message: c.commit.message }));
    },

    async commitFiles(owner, name, branch, files, message) {
      const repo = `/repos/${enc(owner)}/${enc(name)}`;
      const head = await required<{ object: { sha: string } }>(
        "GET",
        `${repo}/git/ref/heads/${enc(branch)}`,
      );
      // 파일마다 blob을 만든다. 같은 내용이면 같은 blob이라 다시 만들어도 안전하다.
      const tree: {
        path: string;
        mode: "100644";
        type: "blob";
        sha: string;
      }[] = [];
      for (const file of files) {
        const blob = await required<{ sha: string }>(
          "POST",
          `${repo}/git/blobs`,
          {
            content: Buffer.from(toBytes(file.content)).toString("base64"),
            encoding: "base64",
          },
        );
        tree.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        });
      }
      // base_tree를 쓰지 않아 저장소 내용이 이 파일들과 정확히 같아진다(초기 README 등은 사라진다).
      const newTree = await required<{ sha: string }>(
        "POST",
        `${repo}/git/trees`,
        { tree },
      );
      const commit = await required<{ sha: string }>(
        "POST",
        `${repo}/git/commits`,
        {
          message,
          tree: newTree.sha,
          parents: [head.object.sha],
        },
      );
      // 강제 갱신하지 않는다. 그 사이 다른 커밋이 생겼다면 실패한다.
      await required("PATCH", `${repo}/git/refs/heads/${enc(branch)}`, {
        sha: commit.sha,
        force: false,
      });
      return { sha: commit.sha };
    },
  };
}
