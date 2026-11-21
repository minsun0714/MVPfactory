/** 공통 설정 계약. 기준 문서: docs/API.md §9 */
import type { IsoDateTime } from "@/contracts/common";
import type { RunLimits } from "@/contracts/runs";

export const PROVIDERS = ["github", "vercel", "supabase"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CONNECTION_STATUSES = [
  "CONNECTED",
  "NOT_CONNECTED",
  "INSUFFICIENT_PERMISSION",
  "DISCONNECTED",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const REPO_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;
export type RepoVisibility = (typeof REPO_VISIBILITIES)[number];

/** 외부 작업 원장의 상태. 이벤트와 DB가 같이 쓴다 */
export const EXTERNAL_OPERATION_STATUSES = [
  "PLANNED",
  "REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
] as const;
export type ExternalOperationStatus =
  (typeof EXTERNAL_OPERATION_STATUSES)[number];

/** 비밀 키는 포함하지 않는다. `.env`에만 둔다 */
export type Connection = {
  provider: Provider;
  status: ConnectionStatus;
  /** 사용자·조직·팀 이름 */
  target: string | null;
  /** 마지막 실제 확인 시각 */
  checkedAt: IsoDateTime | null;
  /** 필요한 조치 */
  message: string | null;
};

export type Settings = {
  connections: Connection[];
  /** 새 저장소 기본값. 기본 PRIVATE */
  repoVisibility: RepoVisibility;
  limits: RunLimits;
  updatedAt: IsoDateTime;
};

export type UpdateSettingsRequest = {
  repoVisibility?: RepoVisibility;
  limits?: Partial<RunLimits>;
};
