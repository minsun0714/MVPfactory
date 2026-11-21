/** 이벤트·SSE 계약. 기준 문서: docs/API.md §6 */
import type { CeoLevel, IsoDateTime, RoleId } from "@/contracts/common";
import type { DecisionChoice, DecisionSummary } from "@/contracts/decisions";
import type { BlockedReason, RunLimits, RunStatus } from "@/contracts/runs";
import type { MeetingOutcome, MeetingReactionKind } from "@/contracts/office";
import type { VerificationResult } from "@/contracts/results";
import type { ExternalOperationStatus, Provider } from "@/contracts/settings";

export const RUN_EVENT_TYPES = [
  "run.accepted",
  "run.status_changed",
  "step.started",
  "step.completed",
  "decision.opened",
  "decision.answered",
  "decision.applied",
  "meeting.started",
  "meeting.statement",
  "meeting.reaction",
  "meeting.ended",
  "verification.recorded",
  "external_operation.observed",
  "run.pause_requested",
  "run.paused",
  "run.blocked",
  "run.failed",
  "run.succeeded",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** 이벤트 종류별 `data`의 모양 */
export interface RunEventDataMap {
  "run.accepted": { projectId: string; ceoLevel: CeoLevel; limits: RunLimits };
  "run.status_changed": {
    from: RunStatus | null;
    to: RunStatus;
    blockedReason: BlockedReason | null;
  };
  "step.started": { stageId: string };
  "step.completed": { stageId: string; artifactId: string | null };
  "decision.opened": { decisionId: string; proposalVersion: number };
  "decision.answered": { decisionId: string; choice: DecisionChoice };
  "decision.applied": { decisionId: string; choice: DecisionChoice };
  "meeting.started": {
    meetingId: string;
    topic: string;
    participants: RoleId[];
  };
  /** 발언 내용은 이벤트의 `summary`, 발언자는 `role` */
  "meeting.statement": { meetingId: string; order: number };
  "meeting.reaction": { meetingId: string; kind: MeetingReactionKind };
  "meeting.ended": { meetingId: string; outcome: MeetingOutcome };
  "verification.recorded": {
    reportId: string;
    counts: Record<VerificationResult, number>;
  };
  "external_operation.observed": {
    provider: Provider;
    operationKind: string;
    status: ExternalOperationStatus;
    resourceId: string | null;
  };
  "run.pause_requested": Record<string, never>;
  "run.paused": Record<string, never>;
  "run.blocked": { reason: BlockedReason; requiredAction: string };
  "run.failed": {
    stage: string;
    retryable: boolean;
    preservedArtifactIds: string[];
  };
  "run.succeeded": {
    appUrl: string | null;
    commitSha: string | null;
    verificationReportId: string | null;
  };
}

type RunEventBase = {
  runId: string;
  /** Run 안에서 1부터 증가. 중복 제거와 이어받기에 사용 */
  sequence: number;
  occurredAt: IsoDateTime;
  stage: string | null;
  role: RoleId | null;
  /** 사용자에게 보여 줄 수 있는 한 줄. 서버가 저장한 실제 결과 */
  summary: string;
  refs: { artifactId?: string; decisionId?: string; meetingId?: string };
};

export type RunEvent = {
  [T in RunEventType]: RunEventBase & { type: T; data: RunEventDataMap[T] };
}[RunEventType];

export type RunEventsQuery = { after?: number; limit?: number };
export type RunEventsPage = { items: RunEvent[]; lastSequence: number };

export const WORKSPACE_EVENT_TYPES = [
  "decision.opened",
  "decision.answered",
  "decision.applied",
  "run.status_changed",
] as const;
export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number];

/** 작업 공간 스트림(`/api/stream`)의 이벤트. 알림·목록 갱신용 요약 */
export type WorkspaceEvent =
  | {
      type: "decision.opened" | "decision.answered" | "decision.applied";
      occurredAt: IsoDateTime;
      decision: DecisionSummary;
    }
  | {
      type: "run.status_changed";
      occurredAt: IsoDateTime;
      projectId: string;
      runId: string;
      status: RunStatus;
      blockedReason: BlockedReason | null;
    };

/** SSE 규칙 값 */
export const SSE = {
  runEventName: "run-event",
  workspaceEventName: "workspace-event",
  heartbeatMs: 15_000,
  retryMs: 2_000,
  heartbeatComment: "ping",
} as const;
