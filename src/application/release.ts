/**
 * 마무리 단계(W19): 검증을 통과한 소스를 GitHub에 올리고 Vercel에 배포한 뒤, 운영 주소가 실제로 열리는지 확인한다.
 *
 * - 배포 성공은 공급자 상태(READY)와 운영 주소의 200 응답이 모두 있을 때만 인정한다.
 * - 배포에 성공해야 마지막 정상 배포를 바꾼다. 실패한 수정은 이전 정상 배포를 그대로 둔다.
 * - 배포 성공은 제품 완료가 아니다. 요구사항별 검증(APP-AC)이 없으면 결과 화면은 "제품 미검증"으로 보여 준다.
 */
import {
  HARNESS_VERSION,
  type VerificationStore,
} from "@/application/build-verification";
import type { ExternalOperationStore } from "@/application/external-operations";
import { publishSourceToGitHub, type GitHubClient } from "@/application/github";
import {
  provisionAppDatabase,
  type AppDatabaseStore,
  type SupabaseAdmin,
} from "@/application/app-database";
import type { DataPlan } from "@/domain/data-plan";
import type { SourceStorage } from "@/application/source-storage";
import { deployToVercel, type VercelClient } from "@/application/vercel";
import { CHECK_DB_ACCESS, CHECK_FINAL_URL } from "@/domain/results";

type Target = { owner: string; isPrivate: boolean };

export interface ReleaseStore {
  recordRepository(
    projectId: string,
    repo: { externalId: string; url: string; visibility: "PRIVATE" | "PUBLIC" },
  ): Promise<void>;
  recordDeploymentProject(
    projectId: string,
    project: { externalId: string; name: string },
  ): Promise<void>;
  /** 배포를 기록한다. 게시(PUBLISHED)면 이전 게시를 SUPERSEDED로 돌리고 마지막 정상 배포로 지정한다. 내부 ID를 돌려준다. */
  recordDeployment(input: {
    projectId: string;
    runId: string;
    providerDeploymentId: string;
    commitSha: string;
    sourceDigest: string;
    url: string | null;
    published: boolean;
  }): Promise<string>;
}

export type ReleaseDeps = {
  github: { client: GitHubClient; target: () => Promise<Target | null> };
  vercel?: {
    client: VercelClient;
    /** 연결 설정의 Vercel 계정. 연결되지 않았으면 null */
    owner: () => Promise<string | null>;
    probe: (url: string) => Promise<number | null>;
    sleep?: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
  };
  /** DB가 필요한 앱에만 쓴다. 공용 Supabase 프로젝트 하나에 앱마다 스키마를 만든다(DEC-005). */
  supabase?: {
    admin: SupabaseAdmin;
    store: AppDatabaseStore;
    /** 공용 프로젝트 참조(.env의 SUPABASE_PROJECT_REF) */
    projectRef: string;
    /** 연결 설정의 Supabase 조직. 연결되지 않았으면 null */
    owner: () => Promise<string | null>;
    /** 공개 키로 앱 데이터 API를 읽어 HTTP 상태를 돌려준다. 연결하지 못하면 null */
    probe: (input: {
      url: string;
      anonKey: string;
      schema: string;
      table: string;
    }) => Promise<number | null>;
  };
  ledger: ExternalOperationStore;
  releases: ReleaseStore;
  verification: VerificationStore;
  storage: SourceStorage;
  secrets: (string | undefined | null)[];
};

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

export async function releaseSource(
  deps: ReleaseDeps,
  input: {
    projectId: string;
    runId: string;
    projectName: string;
    specVersion: number;
    snapshot: { sourceDigest: string; storageRef: string };
    /** 사양의 데이터 계획. 저장이 필요 없는 앱이면 null */
    dataPlan: DataPlan | null;
  },
): Promise<{ repositoryUrl: string; commitSha: string; finalUrl: string }> {
  const target = await deps.github.target();
  if (!target)
    throw new ReleaseError(
      "GitHub 연결 설정이 없어 올리지 않았어요. 공통 설정에서 GitHub 연결을 확인하세요.",
    );
  const files = await deps.storage.get(input.snapshot.storageRef);

  const published = await publishSourceToGitHub(
    { client: deps.github.client, ledger: deps.ledger },
    {
      projectId: input.projectId,
      runId: input.runId,
      projectName: input.projectName,
      owner: target.owner,
      isPrivate: target.isPrivate,
      sourceDigest: input.snapshot.sourceDigest,
      files,
      secrets: deps.secrets,
    },
  );
  await deps.releases.recordRepository(input.projectId, {
    externalId: published.repositoryId,
    url: published.repositoryUrl,
    visibility: target.isPrivate ? "PRIVATE" : "PUBLIC",
  });

  if (!deps.vercel)
    throw new ReleaseError(
      `GitHub에 소스를 올렸어요(${published.repositoryUrl}). Vercel 배포가 아직 구현되지 않아 마무리할 수 없어요. 제품 완료로 보지 않아요.`,
    );
  // DB가 필요한 앱: 배포 전에 앱 스키마를 준비하고 공개 연결 값을 배포 환경변수로 넣는다.
  let database: { url: string; anonKey: string; schema: string } | null = null;
  if (input.dataPlan) {
    if (!deps.supabase)
      throw new ReleaseError(
        "DB가 필요한 앱인데 Supabase 준비가 끝나지 않아 배포하지 않았어요.",
      );
    const owner = await deps.supabase.owner();
    if (!owner)
      throw new ReleaseError(
        "Supabase 연결 설정이 없어 DB를 만들지 않았어요. 공통 설정에서 Supabase 연결을 확인하세요.",
      );
    database = await provisionAppDatabase(
      {
        admin: deps.supabase.admin,
        ledger: deps.ledger,
        store: deps.supabase.store,
      },
      {
        projectId: input.projectId,
        runId: input.runId,
        projectRef: deps.supabase.projectRef,
        owner,
        plan: input.dataPlan,
      },
    );
  }

  const vercelOwner = await deps.vercel.owner();
  if (!vercelOwner)
    throw new ReleaseError(
      "Vercel 연결 설정이 없어 배포하지 않았어요. 공통 설정에서 Vercel 연결을 확인하세요.",
    );

  const deployed = await deployToVercel(
    {
      client: deps.vercel.client,
      ledger: deps.ledger,
      probe: deps.vercel.probe,
      sleep: deps.vercel.sleep,
      pollIntervalMs: deps.vercel.pollIntervalMs,
    },
    {
      projectId: input.projectId,
      runId: input.runId,
      projectName: published.repositoryName,
      owner: vercelOwner,
      sourceDigest: input.snapshot.sourceDigest,
      commitSha: published.commitSha,
      files,
      env: database
        ? {
            NEXT_PUBLIC_SUPABASE_URL: database.url,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: database.anonKey,
            NEXT_PUBLIC_SUPABASE_SCHEMA: database.schema,
          }
        : undefined,
    },
  );
  await deps.releases.recordDeploymentProject(input.projectId, {
    externalId: deployed.vercelProjectId,
    name: published.repositoryName,
  });
  // DB가 있는 앱은 배포된 앱과 같은 공개 키로 데이터 API에 실제로 닿는지 확인한다.
  let dbStatus: number | null = null;
  const readable = input.dataPlan?.tables.find((table) => table.access.read);
  if (database && readable && deps.supabase)
    dbStatus = await deps.supabase.probe({
      url: database.url,
      anonKey: database.anonKey,
      schema: database.schema,
      table: readable.name,
    });
  const dbOk = !database || !readable || dbStatus === 200;
  const ok = deployed.finalUrl !== null && dbOk;
  const deploymentId = await deps.releases.recordDeployment({
    projectId: input.projectId,
    runId: input.runId,
    providerDeploymentId: deployed.deploymentId,
    commitSha: published.commitSha,
    sourceDigest: input.snapshot.sourceDigest,
    url: deployed.finalUrl,
    published: ok,
  });

  // 같은 소스의 빌드·테스트 결과에 운영 주소 확인을 더해 이 배포에 대한 보고서로 남긴다.
  const previous = (
    await deps.verification.latestItems(
      input.runId,
      input.snapshot.sourceDigest,
    )
  ).filter((item) => item.checkId !== CHECK_FINAL_URL);
  await deps.verification.saveReport({
    runId: input.runId,
    specVersion: input.specVersion,
    sourceDigest: input.snapshot.sourceDigest,
    harnessVersion: HARNESS_VERSION,
    commitSha: published.commitSha,
    deploymentId,
    items: [
      ...previous,
      {
        checkId: CHECK_FINAL_URL,
        description: "운영 주소 접속",
        result: ok ? "PASS" : "FAIL",
        evidence: `HTTP ${deployed.finalUrlStatus ?? "응답 없음"}`,
        reason: null,
      },
      ...(database && readable
        ? [
            {
              checkId: CHECK_DB_ACCESS,
              description: "앱 공개 키로 DB 읽기",
              result: dbOk ? ("PASS" as const) : ("FAIL" as const),
              evidence: `${database.schema}.${readable.name}: HTTP ${dbStatus ?? "응답 없음"}`,
              reason: null,
            },
          ]
        : []),
    ],
  });
  if (!ok)
    throw new ReleaseError(
      deployed.finalUrl === null
        ? `배포는 끝났지만 운영 주소가 열리지 않았어요(HTTP ${deployed.finalUrlStatus ?? "응답 없음"}). 마지막 정상 배포는 바꾸지 않았어요.`
        : `배포는 끝났지만 앱이 DB에 접근하지 못했어요(HTTP ${dbStatus ?? "응답 없음"}). 마지막 정상 배포는 바꾸지 않았어요.`,
    );
  return {
    repositoryUrl: published.repositoryUrl,
    commitSha: published.commitSha,
    finalUrl: deployed.finalUrl!,
  };
}
