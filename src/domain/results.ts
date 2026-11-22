import type {
  DatabaseStatus,
  ProductCompletion,
  Result,
  StepResult,
  VerificationItem,
} from "@/contracts/results";
import type { RunMode } from "@/contracts/common";
import type { RunStatus } from "@/contracts/runs";

/** 검증 항목 ID 중 시스템이 약속한 이름. 나머지는 생성 앱의 요구사항별 항목(`APP-AC-*`)이다. */
export const CHECK_BUILD = "BUILD";
export const CHECK_FINAL_URL = "FINAL_URL";
export const CHECK_TESTS = "TESTS";
export const CHECK_SECRETS = "SECRETS";
export const CHECK_DB_ACCESS = "DB_ACCESS";
/** 시스템 검증 항목. 요구사항 충족 여부를 말해 주는 항목이 아니므로 "요구사항 항목"으로 세지 않는다. */
const SYSTEM_CHECKS: string[] = [
  CHECK_BUILD,
  CHECK_FINAL_URL,
  CHECK_TESTS,
  CHECK_SECRETS,
  CHECK_DB_ACCESS,
];

export type ResultInput = {
  latestRun: { id: string; status: RunStatus; mode: RunMode } | null;
  items: Pick<VerificationItem, "id" | "description" | "result">[];
  publishedDeployment: {
    id: string;
    url: string | null;
    commitSha: string;
  } | null;
  repository: { url: string | null; visibility: "PRIVATE" | "PUBLIC" } | null;
  databaseResource: { hasSucceededOperation: boolean } | null;
  lastGood: { commitSha: string; deploymentId: string; at: string } | null;
};

function stepOf(item: { result: string } | undefined): StepResult {
  if (!item) return "NOT_RUN";
  return item.result === "PASS"
    ? "PASS"
    : item.result === "FAIL"
      ? "FAIL"
      : "NOT_RUN";
}

/**
 * 결과 화면의 완료 표시를 계산한다. 빌드 통과, 배포 성공, 제품 완료를 따로 판단한다.
 * - 에이전트의 서술이 아니라 저장된 검증 결과와 배포 기록만 본다.
 * - 데모 실행은 제품 완료가 될 수 없다.
 * - 필수 항목에 FAIL이나 NOT_RUN이 남아 있으면 제품 완료가 아니다.
 */
export function buildResult(input: ResultInput): Result {
  const isDemo = input.latestRun?.mode === "DEMO";
  const build = stepOf(input.items.find((item) => item.id === CHECK_BUILD));
  const finalUrl = stepOf(
    input.items.find((item) => item.id === CHECK_FINAL_URL),
  );
  const deployment: StepResult = input.publishedDeployment
    ? finalUrl
    : "NOT_RUN";

  const requirementItems = input.items.filter(
    (item) => !SYSTEM_CHECKS.includes(item.id),
  );
  const unresolved = requirementItems.filter(
    (item) => item.result === "FAIL" || item.result === "NOT_RUN",
  );
  const anyFailed = [...requirementItems, ...input.items].some(
    (item) => item.result === "FAIL",
  );

  let product: ProductCompletion = "NOT_VERIFIED";
  if (anyFailed) product = "INCOMPLETE";
  else if (
    !isDemo &&
    input.latestRun?.status === "SUCCEEDED" &&
    build === "PASS" &&
    deployment === "PASS" &&
    requirementItems.length > 0 &&
    unresolved.length === 0
  )
    product = "COMPLETE";

  const remainingConstraints: string[] = [];
  if (isDemo)
    remainingConstraints.push(
      "데모 실행입니다. 실제 앱 코드, 저장소, 배포는 만들어지지 않았습니다.",
    );
  for (const item of unresolved)
    remainingConstraints.push(
      `${item.result === "FAIL" ? "실패" : "미검증"}: ${item.description}`,
    );

  const database: Result["database"] = input.databaseResource
    ? {
        provider: "supabase",
        status: (input.databaseResource.hasSucceededOperation
          ? "READY"
          : "UNKNOWN") as DatabaseStatus,
      }
    : null;

  return {
    completion: { build, deployment, product, isDemo },
    app: input.publishedDeployment?.url
      ? { url: input.publishedDeployment.url, accessScope: "PUBLIC_NO_LOGIN" }
      : null,
    repository:
      input.repository?.url && input.publishedDeployment
        ? {
            url: input.repository.url,
            visibility: input.repository.visibility,
            commitSha: input.publishedDeployment.commitSha,
          }
        : null,
    deployment: input.publishedDeployment?.url
      ? {
          id: input.publishedDeployment.id,
          url: input.publishedDeployment.url,
          commitSha: input.publishedDeployment.commitSha,
        }
      : null,
    database,
    lastGood: input.lastGood,
    latestRunId: input.latestRun?.id ?? null,
    remainingConstraints,
  };
}
