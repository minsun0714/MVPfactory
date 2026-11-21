/** 결과·검증 계약. 기준 문서: docs/API.md §10 */
import type { IsoDateTime } from "@/contracts/common";
import type { RepoVisibility } from "@/contracts/settings";

export const VERIFICATION_RESULTS = [
  "PASS",
  "FAIL",
  "NOT_RUN",
  "NOT_APPLICABLE",
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export type StepResult = "PASS" | "FAIL" | "NOT_RUN";
export type ProductCompletion = "COMPLETE" | "INCOMPLETE" | "NOT_VERIFIED";
export type DatabaseStatus = "READY" | "NOT_NEEDED" | "FAILED" | "UNKNOWN";

export type Result = {
  completion: {
    /** 빌드 통과 */
    build: StepResult;
    /** 배포 성공 */
    deployment: StepResult;
    /** 제품 완료. `isDemo`가 true이면 `COMPLETE`가 될 수 없다 */
    product: ProductCompletion;
    isDemo: boolean;
  };
  app: { url: string; accessScope: "PUBLIC_NO_LOGIN" } | null;
  repository: {
    url: string;
    visibility: RepoVisibility;
    commitSha: string;
  } | null;
  deployment: { id: string; url: string; commitSha: string } | null;
  database: { provider: "supabase"; status: DatabaseStatus } | null;
  /** 마지막 정상 결과. 수정 Run이 실패해도 덮어쓰지 않는다 */
  lastGood: { commitSha: string; deploymentId: string; at: IsoDateTime } | null;
  latestRunId: string | null;
  remainingConstraints: string[];
};

export type VerificationItem = {
  /** 예: `APP-AC-001` */
  id: string;
  description: string;
  result: VerificationResult;
  /** 증거 요약 또는 산출물 ID */
  evidence: string | null;
  /** `NOT_APPLICABLE`이면 근거 */
  reason: string | null;
};

export type VerificationReport = {
  runId: string;
  target: {
    specVersion: number;
    commitSha: string | null;
    deploymentId: string | null;
  };
  items: VerificationItem[];
};
