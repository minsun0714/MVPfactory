/** CEO 결정 계약. 기준 문서: docs/API.md §5 */
import type { IsoDateTime, PageQuery } from "@/contracts/common";

export const DECISION_STATUSES = [
  "PREPARED",
  "OPEN",
  "ANSWERED",
  "APPLIED",
  "SUPERSEDED",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_KINDS = [
  "SCOPE_REVIEW",
  "DESIGN_REVIEW",
  "INTEGRATED_REVIEW",
  "EXCEPTION",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_CHOICES = [
  "APPROVE",
  "REQUEST_CHANGES",
  "SELECT_OPTION",
] as const;
export type DecisionChoice = (typeof DECISION_CHOICES)[number];

export type DecisionSummary = {
  id: string;
  runId: string;
  projectId: string;
  kind: DecisionKind;
  status: DecisionStatus;
  proposalVersion: number;
  title: string;
  openedAt: IsoDateTime | null;
};

export type DecisionOption = { id: string; label: string; description: string };

export type Decision = DecisionSummary & {
  /** 한 줄 요약 */
  summary: string;
  /** 제안 내용(이번에 만들 기능, 화면 등) */
  proposal: { heading: string; items: string[] }[];
  /** 이전 제안 대비 변경점. 첫 제안이면 빈 배열 */
  changesFromPrevious: string[];
  /** `EXCEPTION`에서만 사용 */
  options: DecisionOption[];
  response: {
    choice: DecisionChoice;
    optionId: string | null;
    comment: string | null;
    answeredAt: IsoDateTime;
  } | null;
  appliedAt: IsoDateTime | null;
};

export type DecisionListQuery = PageQuery & {
  status?: DecisionStatus;
  projectId?: string;
};

export type DecisionResponseRequest = {
  /** 사용자가 본 제안 버전 */
  proposalVersion: number;
  choice: DecisionChoice;
  /** `SELECT_OPTION`일 때 필수 */
  optionId?: string;
  /** `REQUEST_CHANGES`일 때 필수 */
  comment?: string;
};
