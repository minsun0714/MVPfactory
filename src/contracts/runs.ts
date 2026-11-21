/** 실행(Run) 계약. 기준 문서: docs/API.md §4 */
import type {
  CeoLevel,
  IsoDateTime,
  PageQuery,
  RoleId,
  RunMode,
} from "@/contracts/common";

export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_CEO",
  "PAUSED",
  "BLOCKED",
  "FAILED",
  "SUCCEEDED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TYPES = ["INITIAL", "REVISION"] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const BLOCKED_REASONS = [
  "CONNECTION_MISSING",
  "PERMISSION_DENIED",
  "LIMIT_REACHED",
  "EXTERNAL_RESULT_UNKNOWN",
  "WORKER_UNAVAILABLE",
] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

/** 새 목표 없이 더 진행할 수 없는 종료 상태 */
export const TERMINAL_RUN_STATUSES = [
  "FAILED",
  "SUCCEEDED",
] as const satisfies readonly RunStatus[];

export type Usage = {
  modelCalls: number;
  fixAttempts: number;
  /** CEO 대기 시간은 제외 */
  activeSeconds: number;
  /** CEO 대기 시간 */
  waitingSeconds: number;
  estimatedCost: { amount: number; currency: string; isEstimate: true } | null;
};

/** 설정 입력의 null은 기본값 상속. 설정 조회와 신규 Run은 확정값을 반환하며 과거 Run의 null은 보존한다. */
export type RunLimits = {
  maxModelCalls: number | null;
  maxFixAttempts: number | null;
  maxActiveSeconds: number | null;
  maxEstimatedCost: number | null;
};

export type Run = {
  id: string;
  projectId: string;
  type: RunType;
  mode: RunMode;
  status: RunStatus;
  /** 예: `{ id: "W05", label: "화면 설계" }` */
  stage: { id: string; label: string } | null;
  /** Run 시작 시 고정 */
  ceoLevel: CeoLevel;
  blockedReason: BlockedReason | null;
  failure: { stage: string; message: string; retryable: boolean } | null;
  /** 요청은 받았지만 아직 정지 전 */
  pauseRequested: boolean;
  openDecisionIds: string[];
  usage: Usage;
  limits: RunLimits;
  /** 이 Run의 마지막 이벤트 순번 */
  lastSequence: number;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
};

export type RunListQuery = PageQuery;

export type StartRunRequest = {
  type: RunType;
  mode: RunMode;
  ceoLevel: CeoLevel;
  /** REVISION일 때 필수 */
  feedback?: string;
};

/** 산출물의 작성 주체. 시스템이 남기는 기록(예: 위임 확정 근거)은 `SYSTEM` */
export type ArtifactAuthor = RoleId | "SYSTEM";

export type ArtifactSummary = {
  id: string;
  runId: string;
  author: ArtifactAuthor;
  /** 예: `PRODUCT_SPEC`, `SCREEN_PLAN`, `IMPLEMENTATION_PLAN`, `DELEGATION_RATIONALE` */
  type: string;
  title: string;
  createdAt: IsoDateTime;
};

export type Artifact = ArtifactSummary & {
  /** 작은 산출물은 본문을 포함한다 */
  content: Record<string, unknown> | null;
  /** 큰 파일의 다운로드 링크(유효기간 있음) */
  downloadUrl: string | null;
};

export type RunUsageResponse = { usage: Usage; limits: RunLimits };
