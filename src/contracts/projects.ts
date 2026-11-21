/** 프로젝트 계약. 기준 문서: docs/API.md §3 */
import type { CeoLevel, IsoDateTime, RunMode } from "@/contracts/common";
import type { RunStatus } from "@/contracts/runs";

export type ProjectSummary = {
  id: string;
  name: string;
  archived: boolean;
  latestRun: { id: string; status: RunStatus; mode: RunMode } | null;
  hasOpenDecision: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type Project = ProjectSummary & {
  /** 원본 아이디어 */
  idea: string;
  purpose: string | null;
  constraints: string | null;
  /** 다음 Run의 기본값 */
  ceoLevel: CeoLevel;
  /** 확정 요구사항 */
  confirmedSpec: { version: number; summary: string } | null;
  /** 마지막 정상 배포가 있는지 */
  hasLiveApp: boolean;
};

export type ProjectListQuery = {
  archived?: boolean;
  limit?: number;
  cursor?: string;
};

export type CreateProjectRequest = {
  name: string;
  idea: string;
  purpose?: string;
  constraints?: string;
  ceoLevel: CeoLevel;
};

export type ScopeCheckRequest = {
  idea: string;
  purpose?: string;
  constraints?: string;
};
export type ScopeGap = {
  requirement: string;
  reason: string;
  alternative: string | null;
};
export type ScopeCheckResult = { supported: boolean; gaps: ScopeGap[] };
