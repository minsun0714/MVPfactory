/**
 * GitHub에 저장소를 만들고 검증한 소스를 커밋하는 유스케이스. 공급자 호출은 `GitHubClient`가 하고,
 * 이 모듈은 외부 작업 원장(ledger)으로 중복·재시도·결과 불명확을 다룬다.
 *
 * 지켜야 할 규칙
 * - 대상 계정은 서버에 저장된 연결 설정에서만 온다. 요청·모델이 계정을 바꿀 수 없다.
 * - 이미 있는 저장소라도 우리가 만든 것(설명의 식별자)이 아니면 건드리지 않는다.
 * - 비밀값이나 환경 파일이 있으면 push하지 않는다.
 * - 저장소 공개 범위는 만들 때만 정한다. 나중에 설정이 바뀌어도 기존 저장소를 바꾸지 않는다.
 */
import {
  runExternalOperation,
  type ExternalOperationStore,
} from "@/application/external-operations";
import type { SourceFileInput } from "@/domain/sandbox";
import {
  commitDigestLine,
  repositoryMarker,
  repositoryNameFor,
  stableHash,
} from "@/domain/repository";
import { findSecretLeaks, isForbiddenSourcePath } from "@/domain/secrets";

export type GitHubRepository = {
  id: string;
  name: string;
  htmlUrl: string;
  defaultBranch: string;
  description: string | null;
};

export interface GitHubClient {
  /** 토큰 소유자의 login */
  authenticatedLogin(): Promise<string>;
  getRepository(owner: string, name: string): Promise<GitHubRepository | null>;
  /** 결과를 확인하지 못했다면 `OutcomeUnknownError`를 던진다. */
  createRepository(
    owner: string,
    input: { name: string; description: string; isPrivate: boolean },
  ): Promise<GitHubRepository>;
  /** 기본 브랜치의 최근 커밋 메시지 */
  recentCommits(
    owner: string,
    name: string,
    branch: string,
  ): Promise<{ sha: string; message: string }[]>;
  /** 파일 전체를 한 커밋으로 반영한다(저장소 내용이 이 파일들과 같아진다). */
  commitFiles(
    owner: string,
    name: string,
    branch: string,
    files: SourceFileInput[],
    message: string,
  ): Promise<{ sha: string }>;
}

export class PublishBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishBlockedError";
  }
}

export type PublishInput = {
  projectId: string;
  runId: string;
  projectName: string;
  /** 서버에 저장된 연결 설정의 대상 계정 */
  owner: string;
  isPrivate: boolean;
  sourceDigest: string;
  files: SourceFileInput[];
  /** 소스에 들어가면 안 되는 비밀값 */
  secrets: (string | undefined | null)[];
};

export type PublishResult = {
  repositoryId: string;
  repositoryName: string;
  repositoryUrl: string;
  commitSha: string;
  reusedRepository: boolean;
  reusedCommit: boolean;
};

export async function publishSourceToGitHub(
  deps: { client: GitHubClient; ledger: ExternalOperationStore },
  input: PublishInput,
): Promise<PublishResult> {
  const { client, ledger } = deps;

  // 1) 내보내기 전 마지막 검사. 올릴 파일과 같은 내용을 다시 검사한다.
  const forbidden = input.files.filter((f) => isForbiddenSourcePath(f.path));
  const leaks = findSecretLeaks(
    input.files.map((f) => ({
      path: f.path,
      content:
        typeof f.content === "string"
          ? f.content
          : new TextDecoder().decode(f.content),
    })),
    input.secrets,
  );
  if (forbidden.length > 0 || leaks.length > 0)
    throw new PublishBlockedError(
      "소스에 비밀값이나 환경 파일이 있어 GitHub에 올리지 않았어요.",
    );

  // 2) 토큰 소유자가 저장된 대상 계정과 같은지 확인한다.
  const login = await client.authenticatedLogin();
  if (login.toLowerCase() !== input.owner.toLowerCase())
    throw new PublishBlockedError(
      "GitHub 토큰의 계정이 설정에 저장된 계정과 달라 중단했어요.",
    );

  // 3) 저장소 만들기(프로젝트당 한 번)
  const name = repositoryNameFor(input.projectName, input.projectId);
  const marker = repositoryMarker(input.projectId);
  const description = `MVP 팩토리가 만든 앱 (${marker})`;
  let repository: GitHubRepository | null = null;
  const repoOp = await runExternalOperation(ledger, {
    operationKey: `github:repo:${input.projectId}`,
    projectId: input.projectId,
    runId: input.runId,
    provider: "github",
    kind: "CREATE_REPOSITORY",
    targetAccount: input.owner,
    requestHash: stableHash({
      owner: input.owner,
      name,
      isPrivate: input.isPrivate,
    }),
    async execute() {
      repository = await client.createRepository(input.owner, {
        name,
        description,
        isPrivate: input.isPrivate,
      });
      return {
        externalId: repository.id,
        evidence: { name, url: repository.htmlUrl },
      };
    },
    async reconcile() {
      const existing = await client.getRepository(input.owner, name);
      if (!existing) return { found: false };
      // 이름이 같아도 우리가 심은 식별자가 없으면 남의 저장소다. 건드리지 않는다.
      if (!existing.description?.includes(marker))
        throw new PublishBlockedError(
          "같은 이름의 저장소가 이미 있지만 이 프로젝트가 만든 것이 아니라 사용하지 않았어요.",
        );
      repository = existing;
      return {
        found: true,
        externalId: existing.id,
        evidence: { name, url: existing.htmlUrl },
      };
    },
  });
  repository ??= await client.getRepository(input.owner, name);
  if (!repository)
    throw new PublishBlockedError(
      "저장소를 확인하지 못해 커밋을 올리지 않았어요.",
    );
  const repo: GitHubRepository = repository;

  // 4) 커밋(소스 식별자마다 한 번)
  const digestLine = commitDigestLine(input.sourceDigest);
  let created: { sha: string } | null = null;
  const commitOp = await runExternalOperation(ledger, {
    operationKey: `github:commit:${input.runId}:${input.sourceDigest}`,
    projectId: input.projectId,
    runId: input.runId,
    provider: "github",
    kind: "PUSH_COMMIT",
    targetAccount: input.owner,
    requestHash: stableHash({
      repo: repo.id,
      branch: repo.defaultBranch,
      digest: input.sourceDigest,
    }),
    async execute() {
      created = await client.commitFiles(
        input.owner,
        repo.name,
        repo.defaultBranch,
        input.files,
        `Generated source\n\n${digestLine}`,
      );
      return {
        externalId: created.sha,
        evidence: { digest: input.sourceDigest },
      };
    },
    async reconcile() {
      const commits = await client.recentCommits(
        input.owner,
        repo.name,
        repo.defaultBranch,
      );
      const hit = commits.find((c) => c.message.includes(digestLine));
      return hit
        ? {
            found: true,
            externalId: hit.sha,
            evidence: { digest: input.sourceDigest },
          }
        : { found: false };
    },
  });

  return {
    repositoryId: repo.id,
    repositoryName: repo.name,
    repositoryUrl: repo.htmlUrl,
    commitSha: commitOp.externalId,
    reusedRepository: repoOp.reused,
    reusedCommit: commitOp.reused,
  };
}
