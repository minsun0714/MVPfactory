/**
 * 워커와 워크플로우가 의존하는 저장 계약(Port). 구현은 `src/infrastructure/prisma/workflow-store.ts`에 있다.
 * 각 메서드는 하나의 짧은 트랜잭션으로 처리되며 호출할 때마다 같은 결과가 나오도록(멱등) 만든다.
 */
import type { CeoLevel, RoleId, RunMode } from "@/contracts/common";
import type {
  DecisionChoice,
  DecisionKind,
  DecisionStatus,
} from "@/contracts/decisions";
import type { MeetingOutcome, MeetingReactionKind } from "@/contracts/office";
import type { ArtifactAuthor, RunStatus } from "@/contracts/runs";
import type { DecisionDraft } from "@/domain/demo-content";
import type { StepDef } from "@/domain/workflow";

export type ClaimedJob = {
  id: string;
  runId: string;
  kind: "START" | "RESUME" | "RECOVER";
  claimEpoch: number;
};

export type RunSnapshot = {
  id: string;
  projectId: string;
  threadId: string;
  status: RunStatus;
  pauseRequested: boolean;
  ceoLevel: CeoLevel;
  mode: RunMode;
  type: "INITIAL" | "REVISION";
  feedback: string | null;
  project: {
    name: string;
    idea: string;
    purpose: string | null;
    constraints: string | null;
  };
};

export type ArtifactInput = {
  author: ArtifactAuthor;
  type: string;
  title: string;
  content: Record<string, string>;
};

export type StoredArtifact = {
  id: string;
  type: string;
  revision: number;
  content: Record<string, string>;
};

export type DecisionRecord = {
  id: string;
  runId: string;
  kind: DecisionKind;
  status: DecisionStatus;
  round: number;
  response: { choice: DecisionChoice; comment: string | null } | null;
};

export type MeetingDraft = {
  runId: string;
  decisionId: string | null;
  topic: string;
  participants: RoleId[];
};

export type Failure = { stage: string; message: string; retryable: boolean };

export interface WorkflowStore {
  // ── 작업 큐
  /** 대기 중인 Job 하나를 인수한다. 없으면 null */
  claimJob(workerId: string): Promise<ClaimedJob | null>;
  finishJob(
    job: ClaimedJob,
    outcome: { status: "DONE" | "FAILED"; noOpReason?: string; error?: string },
  ): Promise<void>;
  /** 워커가 비정상 종료되어 `RUNNING`으로 남은 Job과 Run을 대기열로 되돌린다. */
  recoverInterruptedJobs(): Promise<number>;
  recordHeartbeat(instanceId: string, version: string): Promise<void>;

  // ── Run 상태
  loadRun(runId: string): Promise<RunSnapshot | null>;
  /** `QUEUED` → `RUNNING`. 이미 다른 상태면 false */
  startRun(runId: string): Promise<boolean>;
  /** 정지 요청이 있으면 `PAUSED`로 바꾸고 true */
  pauseIfRequested(runId: string): Promise<boolean>;
  succeedRun(runId: string): Promise<void>;
  failRun(runId: string, failure: Failure): Promise<void>;
  addActiveSeconds(runId: string, seconds: number): Promise<void>;

  // ── 단계와 산출물
  beginStep(runId: string, step: StepDef): Promise<void>;
  completeStep(
    runId: string,
    step: StepDef,
    summary: string,
    artifactId: string | null,
  ): Promise<void>;
  /** 같은 내용이면 그대로 두고, 내용이 바뀌었으면 새 revision으로 저장한다. */
  saveArtifact(runId: string, input: ArtifactInput): Promise<StoredArtifact>;
  latestArtifacts(runId: string): Promise<Record<string, StoredArtifact>>;
  /** 이 Run에서 `REQUEST_CHANGES`로 적용된 결정의 의견(오래된 순) */
  collectFeedback(runId: string, kinds?: DecisionKind[]): Promise<string[]>;
  freezeSpec(
    runId: string,
    spec: { summary: string; content: Record<string, unknown> },
  ): Promise<number>;

  // ── CEO 결정
  /** 같은 검토 지점에 아직 처리 중인 결정이 있으면 그것을, 아니면 새 회차를 만든다. */
  prepareDecision(
    runId: string,
    kind: Exclude<DecisionKind, "EXCEPTION">,
    draft: DecisionDraft,
    changes: string[],
  ): Promise<DecisionRecord>;
  findDecision(decisionId: string): Promise<DecisionRecord | null>;
  /** 이 검토 지점에서 아직 반영하지 않은(`PREPARED`·`OPEN`·`ANSWERED`) 가장 최근 결정 */
  findActiveDecision(
    runId: string,
    kind: DecisionKind,
  ): Promise<DecisionRecord | null>;
  /** `PREPARED` → `OPEN`, Run `RUNNING` → `WAITING_CEO` (저장된 interrupt가 있을 때만 호출) */
  openDecision(decisionId: string): Promise<void>;
  /** 열려 있는 결정이 있는데 Run이 아직 `RUNNING`이면 `WAITING_CEO`로 맞춘다. */
  ensureWaiting(runId: string): Promise<void>;
  /** `ANSWERED` → `APPLIED`. 이미 적용했으면 같은 결과를 돌려준다. */
  applyDecision(
    decisionId: string,
  ): Promise<{ choice: DecisionChoice; comment: string | null }>;
  latestAppliedChoice(
    runId: string,
    kind: DecisionKind,
  ): Promise<DecisionChoice | null>;

  // ── 회의 (실제 작업·결정과 연결된 회의만 만든다)
  /** 같은 결정(또는 같은 주제)의 회의가 있으면 그것을 돌려준다. */
  startMeeting(draft: MeetingDraft): Promise<{ id: string; created: boolean }>;
  addMeetingEntry(
    meetingId: string,
    entry:
      | { kind: "STATEMENT"; order: number; role: RoleId; summary: string }
      | {
          kind: "REACTION";
          order: number;
          role: RoleId;
          reaction: MeetingReactionKind;
        },
  ): Promise<void>;
  endMeeting(
    meetingId: string,
    outcome: MeetingOutcome,
    summary: string,
  ): Promise<void>;
  endMeetingOfDecision(decisionId: string, summary: string): Promise<void>;
}
