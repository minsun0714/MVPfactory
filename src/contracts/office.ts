/** 사무실 화면·회의 계약. 기준 문서: docs/API.md §7 */
import type { IsoDateTime, RoleId } from "@/contracts/common";
import type { DecisionSummary } from "@/contracts/decisions";
import type { ProjectSummary } from "@/contracts/projects";
import type { Run } from "@/contracts/runs";

export const ROLE_STATUSES = [
  "IDLE",
  "WORKING",
  "WAITING",
  "DONE",
  "FAILED",
] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const MEETING_STATUSES = [
  "IN_PROGRESS",
  "WAITING_CEO",
  "ENDED",
  "FAILED",
  "INTERRUPTED",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** 회의 종료 결과. `meeting.ended` 이벤트가 사용한다 */
export const MEETING_OUTCOMES = [
  "DECIDED",
  "WAITING_CEO",
  "FAILED",
  "INTERRUPTED",
] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

/** 참여자 반응 종류 */
export const MEETING_REACTION_KINDS = ["NOD", "THINK", "ALERT"] as const;
export type MeetingReactionKind = (typeof MEETING_REACTION_KINDS)[number];

export type MeetingSummary = {
  id: string;
  runId: string;
  decisionId: string | null;
  topic: string;
  /** 최대 4명 */
  participants: RoleId[];
  status: MeetingStatus;
};

export type MeetingStatement = {
  order: number;
  /** 이 발언을 알린 이벤트의 순번 */
  sequence: number;
  role: RoleId;
  summary: string;
};

export type MeetingReaction = {
  sequence: number;
  role: RoleId;
  kind: MeetingReactionKind;
};

export type Meeting = MeetingSummary & {
  statements: MeetingStatement[];
  reactions: MeetingReaction[];
  /** 결정 결과 요약 */
  outcome: string | null;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
};

export type RoleState = {
  role: RoleId;
  status: RoleStatus;
  /** 실제 작업 요약. 서버가 저장한 문구 */
  currentTask: string | null;
  latestArtifactId: string | null;
};

/** 화면을 열거나 새로고침할 때 한 번에 복원하는 집계 */
export type OfficeState = {
  project: ProjectSummary;
  run: Run | null;
  roles: RoleState[];
  /** 진행 중이거나 CEO 대기 중인 회의 */
  activeMeeting: MeetingSummary | null;
  openDecisions: DecisionSummary[];
  latestNews: { sequence: number; role: RoleId | null; text: string } | null;
  /** 이 값 이후의 이벤트를 SSE로 이어받는다 */
  lastSequence: number;
};
