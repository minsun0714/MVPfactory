/**
 * Vercel에 프로젝트를 만들고, 검증을 통과한 소스를 배포하고, 최종 주소가 실제로 열리는지 확인하는 유스케이스.
 * 공급자 호출은 `VercelClient`가 하고, 중복·재시도·결과 불명확은 외부 작업 원장으로 다룬다.
 *
 * 지켜야 할 규칙
 * - 대상 계정은 서버에 저장된 연결 설정에서만 온다. 토큰의 계정이 다르면 멈춘다.
 * - 배포 결과는 공급자의 상태(READY)와 최종 주소의 실제 응답으로만 판단한다.
 * - 빌드가 실패한 배포는 공개 주소에 연결되지 않는다(Vercel은 READY가 된 배포만 운영 주소에 붙인다).
 */
import {
  runExternalOperation,
  type ExternalOperationStore,
} from "@/application/external-operations";
import type { SourceFileInput } from "@/domain/sandbox";
import { stableHash } from "@/domain/repository";
import { toBytes } from "@/domain/sandbox";

export type VercelDeploymentState =
  "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export type VercelDeployment = {
  id: string;
  /** 이 배포만의 주소(보호될 수 있다) */
  url: string;
  state: VercelDeploymentState;
  /** 운영 주소(READY 뒤에 붙는다) */
  aliases: string[];
  meta: Record<string, string>;
};

export interface VercelClient {
  authenticatedUsername(): Promise<string>;
  getProject(name: string): Promise<{ id: string; name: string } | null>;
  /** 결과를 확인하지 못했다면 `OutcomeUnknownError` */
  createProject(name: string): Promise<{ id: string; name: string }>;
  /** 프로젝트 환경변수를 넣거나 바꾼다(같은 키는 덮어쓴다). 공개 가능한 값만 넣는다. */
  setProjectEnv(projectId: string, vars: Record<string, string>): Promise<void>;
  /** 파일 내용을 올리고 sha1을 돌려준다. 같은 내용은 다시 올려도 안전하다. */
  uploadFile(content: Buffer): Promise<string>;
  /** 결과를 확인하지 못했다면 `OutcomeUnknownError` */
  createDeployment(input: {
    projectName: string;
    files: { file: string; sha: string; size: number }[];
    meta: Record<string, string>;
  }): Promise<VercelDeployment>;
  getDeployment(id: string): Promise<VercelDeployment>;
  /** 프로젝트의 최근 배포 중 meta가 일치하는 것 */
  findDeployment(
    projectId: string,
    key: string,
    value: string,
  ): Promise<VercelDeployment | null>;
}

export class DeployBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployBlockedError";
  }
}

export class DeployFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployFailedError";
  }
}

export type DeployInput = {
  projectId: string;
  runId: string;
  /** Vercel 프로젝트 이름. 저장소 이름과 같게 써서 프로젝트마다 하나로 고정한다. */
  projectName: string;
  owner: string;
  sourceDigest: string;
  commitSha: string;
  files: SourceFileInput[];
  /** 빌드·실행에 쓰는 공개 환경변수(예: DB 공개 연결 값). 배포 전에 프로젝트에 넣는다. */
  env?: Record<string, string>;
};

export type DeployResult = {
  vercelProjectId: string;
  deploymentId: string;
  /** 운영 주소. 응답 확인을 통과했을 때만 값이 있다. */
  finalUrl: string | null;
  finalUrlStatus: number | null;
  reusedDeployment: boolean;
};

export const DIGEST_META = "mvpfactorySourceDigest";

export async function deployToVercel(
  deps: {
    client: VercelClient;
    ledger: ExternalOperationStore;
    /** 최종 주소를 열어 HTTP 상태를 돌려준다. 연결하지 못하면 null */
    probe: (url: string) => Promise<number | null>;
    sleep?: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
    maxWaitMs?: number;
  },
  input: DeployInput,
): Promise<DeployResult> {
  const { client, ledger } = deps;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const username = await client.authenticatedUsername();
  if (username.toLowerCase() !== input.owner.toLowerCase())
    throw new DeployBlockedError(
      "Vercel 토큰의 계정이 설정에 저장된 계정과 달라 중단했어요.",
    );

  // 1) 프로젝트(프로젝트당 한 번). 이름에 프로젝트 ID 끝부분이 들어 있어 다른 프로젝트와 겹치지 않는다.
  const project = await runExternalOperation(ledger, {
    operationKey: `vercel:project:${input.projectId}`,
    projectId: input.projectId,
    runId: input.runId,
    provider: "vercel",
    kind: "CREATE_PROJECT",
    targetAccount: input.owner,
    requestHash: stableHash({ owner: input.owner, name: input.projectName }),
    async execute() {
      const created = await client.createProject(input.projectName);
      return { externalId: created.id, evidence: { name: created.name } };
    },
    async reconcile() {
      const found = await client.getProject(input.projectName);
      return found
        ? { found: true, externalId: found.id, evidence: { name: found.name } }
        : { found: false };
    },
  });

  if (input.env && Object.keys(input.env).length > 0)
    await client.setProjectEnv(project.externalId, input.env);

  // 2) 파일 올리기(내용 주소 기반이라 반복해도 안전하다)
  const manifest: { file: string; sha: string; size: number }[] = [];
  for (const file of input.files) {
    const content = Buffer.from(toBytes(file.content));
    manifest.push({
      file: file.path,
      sha: await client.uploadFile(content),
      size: content.byteLength,
    });
  }

  // 3) 배포(소스 식별자마다 한 번)
  const deployment = await runExternalOperation(ledger, {
    operationKey: `vercel:deploy:${input.runId}:${input.sourceDigest}`,
    projectId: input.projectId,
    runId: input.runId,
    provider: "vercel",
    kind: "CREATE_DEPLOYMENT",
    targetAccount: input.owner,
    requestHash: stableHash({
      project: project.externalId,
      digest: input.sourceDigest,
      commit: input.commitSha,
      env: input.env ?? {},
    }),
    async execute() {
      const created = await client.createDeployment({
        projectName: input.projectName,
        files: manifest,
        meta: {
          [DIGEST_META]: input.sourceDigest,
          mvpfactoryCommit: input.commitSha,
        },
      });
      return { externalId: created.id, evidence: { url: created.url } };
    },
    async reconcile() {
      const found = await client.findDeployment(
        project.externalId,
        DIGEST_META,
        input.sourceDigest,
      );
      return found
        ? { found: true, externalId: found.id, evidence: { url: found.url } }
        : { found: false };
    },
  });

  // 4) 빌드가 끝날 때까지 기다린다. 성공·실패는 공급자 상태로만 판단한다.
  const interval = deps.pollIntervalMs ?? 5000;
  const deadline = Date.now() + (deps.maxWaitMs ?? 15 * 60 * 1000);
  let current = await client.getDeployment(deployment.externalId);
  while (!["READY", "ERROR", "CANCELED"].includes(current.state)) {
    if (Date.now() > deadline)
      throw new DeployFailedError(
        "Vercel 배포가 시간 안에 끝나지 않았어요. 다시 시도하면 같은 배포를 이어서 확인해요.",
      );
    await sleep(interval);
    current = await client.getDeployment(deployment.externalId);
  }
  if (current.state !== "READY")
    throw new DeployFailedError(
      `Vercel 배포가 실패했어요(${current.state}). 마지막 정상 배포는 그대로 유지돼요.`,
    );

  // 5) 운영 주소가 실제로 열리는지 확인한다.
  const alias = current.aliases[0] ?? null;
  const finalUrl = alias ? `https://${alias}` : null;
  const status = finalUrl ? await deps.probe(finalUrl) : null;
  return {
    vercelProjectId: project.externalId,
    deploymentId: current.id,
    finalUrl: finalUrl && status === 200 ? finalUrl : null,
    finalUrlStatus: status,
    reusedDeployment: deployment.reused,
  };
}
