import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ArtifactInput,
  ClaimedJob,
  DecisionRecord,
  Failure,
  MeetingDraft,
  RunSnapshot,
  StoredArtifact,
  WorkflowStore,
} from "@/application/workflow-ports";
import type { DecisionChoice, MeetingOutcome } from "@/contracts";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { hashRequest } from "@/infrastructure/prisma/idempotency";

type Tx = Prisma.TransactionClient;

const MEETING_STATUS: Record<
  MeetingOutcome,
  "ENDED" | "WAITING_CEO" | "FAILED" | "INTERRUPTED"
> = {
  DECIDED: "ENDED",
  WAITING_CEO: "WAITING_CEO",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
};

function toDecisionRecord(row: {
  id: string;
  runId: string;
  kind: DecisionRecord["kind"];
  status: DecisionRecord["status"];
  round: number;
  responseChoice: DecisionChoice | null;
  responseComment: string | null;
}): DecisionRecord {
  return {
    id: row.id,
    runId: row.runId,
    kind: row.kind,
    status: row.status,
    round: row.round,
    response: row.responseChoice
      ? { choice: row.responseChoice, comment: row.responseComment }
      : null,
  };
}

const asStrings = (value: Prisma.JsonValue | null): Record<string, string> =>
  (value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}) as Record<string, string>;

/** 같은 단계의 마지막 `step.*` 이벤트 종류. 다시 실행된 단계가 이벤트를 중복해서 남기지 않게 한다. */
async function lastStepEvent(tx: Tx, runId: string, nodeId: string) {
  const event = await tx.runEvent.findFirst({
    where: {
      runId,
      stageId: nodeId,
      type: { in: ["step.started", "step.completed"] },
    },
    orderBy: { sequence: "desc" },
    select: { type: true },
  });
  return event?.type ?? null;
}

/**
 * CEO 응답을 기다리는 상태로 맞춘다. 정지 요청이 있었다면 대기 대신 정지한다
 * (열린 결정은 그대로 남고, 재개하면 다시 CEO 대기로 돌아간다).
 */
async function moveToWaiting(tx: Tx, runId: string): Promise<void> {
  const run = await tx.run.findUnique({
    where: { id: runId },
    select: { status: true, pauseRequested: true },
  });
  if (!run || run.status !== "RUNNING") return;
  const target = run.pauseRequested ? "PAUSED" : "WAITING_CEO";
  const moved = await tx.run.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { status: target, pauseRequested: false },
  });
  if (moved.count === 0) return;
  if (target === "PAUSED")
    await appendRunEvent(tx, runId, {
      type: "run.paused",
      summary: "실행이 일시정지되었습니다.",
      data: {},
    });
  await appendRunEvent(tx, runId, {
    type: "run.status_changed",
    summary: target === "PAUSED" ? "일시정지" : "대표님의 응답을 기다려요.",
    data: { from: "RUNNING", to: target, blockedReason: null },
  });
}

export function createWorkflowStore(db: PrismaClient): WorkflowStore {
  return {
    // ── 작업 큐
    async claimJob(workerId) {
      const rows = await db.$queryRaw<ClaimedJob[]>`
        UPDATE "Job"
        SET "status" = 'RUNNING', "claimedBy" = ${workerId}, "claimEpoch" = "claimEpoch" + 1,
            "attempt" = "attempt" + 1, "startedAt" = now()
        WHERE "id" = (
          SELECT "id" FROM "Job"
          WHERE "status" = 'QUEUED' AND ("notBefore" IS NULL OR "notBefore" <= now())
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING "id", "runId", "kind", "claimEpoch"`;
      return rows[0] ?? null;
    },

    async finishJob(job, outcome) {
      await db.job.updateMany({
        // 소유권(claimEpoch)이 바뀐 오래된 워커의 결과는 적용하지 않는다.
        where: { id: job.id, claimEpoch: job.claimEpoch, status: "RUNNING" },
        data: {
          status: outcome.status,
          finishedAt: new Date(),
          noOpReason: outcome.noOpReason ?? null,
          error: outcome.error ?? null,
        },
      });
    },

    async recoverInterruptedJobs() {
      return db.$transaction(async (tx) => {
        const jobs = await tx.job.findMany({
          where: { status: "RUNNING" },
          select: { id: true, runId: true },
        });
        for (const job of jobs) {
          await tx.job.update({
            where: { id: job.id },
            data: { status: "QUEUED", claimedBy: null },
          });
          const moved = await tx.run.updateMany({
            where: { id: job.runId, status: "RUNNING" },
            data: { status: "QUEUED" },
          });
          if (moved.count === 1)
            await appendRunEvent(tx, job.runId, {
              type: "run.status_changed",
              summary: "워커가 다시 시작되어 실행을 이어서 진행합니다.",
              data: { from: "RUNNING", to: "QUEUED", blockedReason: null },
            });
        }
        return jobs.length;
      });
    },

    async recordHeartbeat(instanceId, version) {
      await db.workerHeartbeat.upsert({
        where: { instanceId },
        create: { instanceId, lastSeenAt: new Date(), version },
        update: { lastSeenAt: new Date(), version },
      });
    },

    // ── Run 상태
    async loadRun(runId): Promise<RunSnapshot | null> {
      const run = await db.run.findUnique({
        where: { id: runId },
        include: { project: true },
      });
      if (!run) return null;
      return {
        id: run.id,
        projectId: run.projectId,
        threadId: run.threadId,
        status: run.status,
        pauseRequested: run.pauseRequested,
        ceoLevel: run.ceoLevel,
        mode: run.mode,
        type: run.type,
        feedback: run.feedback,
        project: {
          name: run.project.name,
          idea: run.project.idea,
          purpose: run.project.purpose,
          constraints: run.project.constraints,
        },
      };
    },

    startRun(runId) {
      return db.$transaction(async (tx) => {
        const moved = await tx.run.updateMany({
          where: { id: runId, status: "QUEUED" },
          data: { status: "RUNNING" },
        });
        if (moved.count === 0) return false;
        await tx.run.updateMany({
          where: { id: runId, startedAt: null },
          data: { startedAt: new Date() },
        });
        await appendRunEvent(tx, runId, {
          type: "run.status_changed",
          summary: "실행을 시작했어요.",
          data: { from: "QUEUED", to: "RUNNING", blockedReason: null },
        });
        return true;
      });
    },

    pauseIfRequested(runId) {
      return db.$transaction(async (tx) => {
        const moved = await tx.run.updateMany({
          where: { id: runId, status: "RUNNING", pauseRequested: true },
          data: { status: "PAUSED", pauseRequested: false },
        });
        if (moved.count === 0) return false;
        await appendRunEvent(tx, runId, {
          type: "run.paused",
          summary: "실행이 일시정지되었습니다.",
          data: {},
        });
        await appendRunEvent(tx, runId, {
          type: "run.status_changed",
          summary: "일시정지",
          data: { from: "RUNNING", to: "PAUSED", blockedReason: null },
        });
        return true;
      });
    },

    succeedRun(runId) {
      return db.$transaction(async (tx) => {
        const moved = await tx.run.updateMany({
          where: { id: runId, status: "RUNNING" },
          data: {
            status: "SUCCEEDED",
            finishedAt: new Date(),
            stageId: "W19",
            stageLabel: "완료",
          },
        });
        if (moved.count === 0) return;
        await tx.activeRunLock.deleteMany({ where: { runId } });
        await appendRunEvent(tx, runId, {
          type: "run.succeeded",
          summary:
            "데모 실행이 끝났어요. 실제 앱 코드와 배포는 만들어지지 않았어요.",
          data: { appUrl: null, commitSha: null, verificationReportId: null },
        });
        await appendRunEvent(tx, runId, {
          type: "run.status_changed",
          summary: "완료",
          data: { from: "RUNNING", to: "SUCCEEDED", blockedReason: null },
        });
      });
    },

    failRun(runId, failure: Failure) {
      return db.$transaction(async (tx) => {
        const moved = await tx.run.updateMany({
          where: { id: runId, status: { in: ["RUNNING", "QUEUED"] } },
          data: {
            status: "FAILED",
            failure: failure as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        });
        if (moved.count === 0) return;
        await tx.activeRunLock.deleteMany({ where: { runId } });
        const artifacts = await tx.artifact.findMany({
          where: { runId },
          select: { id: true },
        });
        await appendRunEvent(tx, runId, {
          type: "run.failed",
          summary: `실행이 멈췄어요: ${failure.message}`,
          stageId: null,
          data: {
            stage: failure.stage,
            retryable: failure.retryable,
            preservedArtifactIds: artifacts.map((artifact) => artifact.id),
          },
        });
        await appendRunEvent(tx, runId, {
          type: "run.status_changed",
          summary: "실패",
          data: { from: "RUNNING", to: "FAILED", blockedReason: null },
        });
      });
    },

    async addActiveSeconds(runId, seconds) {
      if (seconds <= 0) return;
      await db.$transaction([
        db.run.update({
          where: { id: runId },
          data: { usageActiveSeconds: { increment: seconds } },
        }),
        db.usageRecord.create({
          data: { runId, kind: "ACTIVE_TIME", amount: seconds },
        }),
      ]);
    },

    // ── 단계와 산출물
    beginStep(runId, step) {
      return db.$transaction(async (tx) => {
        await tx.run.update({
          where: { id: runId },
          data: { stageId: step.nodeId, stageLabel: step.label },
        });
        if ((await lastStepEvent(tx, runId, step.nodeId)) === "step.started")
          return;
        await appendRunEvent(tx, runId, {
          type: "step.started",
          summary: `${step.label} 단계를 시작했어요.`,
          stageId: step.nodeId,
          role: step.role,
          data: { stageId: step.nodeId },
        });
      });
    },

    completeStep(runId, step, summary, artifactId) {
      return db.$transaction(async (tx) => {
        if ((await lastStepEvent(tx, runId, step.nodeId)) !== "step.started")
          return;
        await appendRunEvent(tx, runId, {
          type: "step.completed",
          summary,
          stageId: step.nodeId,
          role: step.role,
          refs: artifactId ? { artifactId } : {},
          data: { stageId: step.nodeId, artifactId },
        });
      });
    },

    async saveArtifact(runId, input: ArtifactInput): Promise<StoredArtifact> {
      const latest = await db.artifact.findFirst({
        where: { runId, type: input.type },
        orderBy: { revision: "desc" },
      });
      const checksum = hashRequest(input.content);
      if (latest && latest.checksum === checksum)
        return {
          id: latest.id,
          type: latest.type,
          revision: latest.revision,
          content: asStrings(latest.content),
        };
      const created = await db.artifact.create({
        data: {
          runId,
          author: input.author,
          type: input.type,
          revision: (latest?.revision ?? 0) + 1,
          title: input.title,
          schemaVersion: 1,
          content: input.content,
          checksum,
        },
      });
      return {
        id: created.id,
        type: created.type,
        revision: created.revision,
        content: input.content,
      };
    },

    async latestArtifacts(runId) {
      const rows = await db.artifact.findMany({
        where: { runId },
        orderBy: { revision: "desc" },
      });
      const result: Record<string, StoredArtifact> = {};
      for (const row of rows)
        if (!result[row.type])
          result[row.type] = {
            id: row.id,
            type: row.type,
            revision: row.revision,
            content: asStrings(row.content),
          };
      return result;
    },

    async collectFeedback(runId, kinds) {
      const rows = await db.decision.findMany({
        where: {
          runId,
          status: "APPLIED",
          responseChoice: "REQUEST_CHANGES",
          ...(kinds ? { kind: { in: kinds } } : {}),
        },
        orderBy: { appliedAt: "asc" },
        select: { responseComment: true },
      });
      return rows
        .map((row) => row.responseComment)
        .filter((comment): comment is string => Boolean(comment));
    },

    freezeSpec(runId, spec) {
      return db.$transaction(async (tx) => {
        const run = await tx.run.findUniqueOrThrow({
          where: { id: runId },
          select: { projectId: true },
        });
        const checksum = hashRequest(spec.content);
        const existing = await tx.productSpec.findFirst({
          where: { projectId: run.projectId, createdByRunId: runId },
          orderBy: { version: "desc" },
        });
        let version = existing?.version ?? 0;
        if (!existing || hashRequest(existing.content) !== checksum) {
          const latest = await tx.productSpec.findFirst({
            where: { projectId: run.projectId },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          version = (latest?.version ?? 0) + 1;
          await tx.productSpec.create({
            data: {
              projectId: run.projectId,
              version,
              schemaVersion: 1,
              summary: spec.summary,
              content: spec.content as Prisma.InputJsonValue,
              createdByRunId: runId,
            },
          });
        }
        await tx.project.update({
          where: { id: run.projectId },
          data: { confirmedSpecVersion: version },
        });
        return version;
      });
    },

    // ── CEO 결정
    async prepareDecision(runId, kind, draft, changes) {
      const latest = await db.decision.findFirst({
        where: { runId, kind },
        orderBy: { round: "desc" },
      });
      if (latest && ["PREPARED", "OPEN", "ANSWERED"].includes(latest.status))
        return toDecisionRecord(latest);
      const round = (latest?.round ?? 0) + 1;
      const created = await db.decision.create({
        data: {
          runId,
          kind,
          round,
          proposalVersion: round,
          proposalFingerprint: hashRequest({ draft, changes, round }),
          title: draft.title,
          summary: draft.summary,
          proposal: draft.proposal as Prisma.InputJsonValue,
          changesFromPrevious: changes as Prisma.InputJsonValue,
          options: [],
        },
      });
      return toDecisionRecord(created);
    },

    async findDecision(decisionId) {
      const row = await db.decision.findUnique({ where: { id: decisionId } });
      return row ? toDecisionRecord(row) : null;
    },

    async findActiveDecision(runId, kind) {
      const row = await db.decision.findFirst({
        where: {
          runId,
          kind,
          status: { in: ["PREPARED", "OPEN", "ANSWERED"] },
        },
        orderBy: { round: "desc" },
      });
      return row ? toDecisionRecord(row) : null;
    },

    openDecision(decisionId) {
      return db.$transaction(async (tx) => {
        const opened = await tx.decision.updateMany({
          where: { id: decisionId, status: "PREPARED" },
          data: { status: "OPEN", openedAt: new Date() },
        });
        const decision = await tx.decision.findUniqueOrThrow({
          where: { id: decisionId },
        });
        if (opened.count === 1) {
          await tx.meeting.updateMany({
            where: { decisionId, status: "IN_PROGRESS" },
            data: { status: "WAITING_CEO" },
          });
          await appendRunEvent(tx, decision.runId, {
            type: "decision.opened",
            summary: `대표님의 검토가 필요해요: ${decision.title}`,
            role: "PM",
            refs: { decisionId },
            data: { decisionId, proposalVersion: decision.proposalVersion },
          });
        }
        if (decision.status === "OPEN") await moveToWaiting(tx, decision.runId);
      });
    },

    ensureWaiting(runId) {
      return db.$transaction(async (tx) => {
        const open = await tx.decision.count({
          where: { runId, status: "OPEN" },
        });
        if (open > 0) await moveToWaiting(tx, runId);
      });
    },

    applyDecision(decisionId) {
      return db.$transaction(async (tx) => {
        const row = await tx.decision.findUniqueOrThrow({
          where: { id: decisionId },
        });
        if (row.status === "ANSWERED") {
          const applied = await tx.decision.updateMany({
            where: { id: decisionId, status: "ANSWERED", appliedAt: null },
            data: { status: "APPLIED", appliedAt: new Date() },
          });
          if (applied.count === 1) {
            if (row.openedAt && row.answeredAt) {
              const waited = Math.max(
                0,
                Math.round(
                  (row.answeredAt.getTime() - row.openedAt.getTime()) / 1000,
                ),
              );
              await tx.run.update({
                where: { id: row.runId },
                data: { usageWaitingSeconds: { increment: waited } },
              });
            }
            await appendRunEvent(tx, row.runId, {
              type: "decision.applied",
              summary: "대표님의 응답을 반영했어요.",
              refs: { decisionId },
              data: {
                decisionId,
                choice: row.responseChoice as DecisionChoice,
              },
            });
          }
        } else if (row.status !== "APPLIED") {
          throw new Error("응답이 저장되지 않은 결정은 반영할 수 없습니다.");
        }
        return {
          choice: row.responseChoice as DecisionChoice,
          comment: row.responseComment,
        };
      });
    },

    async latestAppliedChoice(runId, kind) {
      const row = await db.decision.findFirst({
        where: { runId, kind, status: "APPLIED" },
        orderBy: { round: "desc" },
        select: { responseChoice: true },
      });
      return row?.responseChoice ?? null;
    },

    // ── 회의
    startMeeting(draft: MeetingDraft) {
      return db.$transaction(async (tx) => {
        const existing = await tx.meeting.findFirst({
          where: draft.decisionId
            ? { runId: draft.runId, decisionId: draft.decisionId }
            : { runId: draft.runId, topic: draft.topic },
        });
        if (existing) return { id: existing.id, created: false };
        const meeting = await tx.meeting.create({
          data: {
            runId: draft.runId,
            decisionId: draft.decisionId,
            topic: draft.topic,
            participants: draft.participants,
            startedAt: new Date(),
          },
        });
        await appendRunEvent(tx, draft.runId, {
          type: "meeting.started",
          summary: `${draft.topic} 회의를 시작했어요.`,
          refs: {
            meetingId: meeting.id,
            ...(draft.decisionId ? { decisionId: draft.decisionId } : {}),
          },
          data: {
            meetingId: meeting.id,
            topic: draft.topic,
            participants: draft.participants,
          },
        });
        return { id: meeting.id, created: true };
      });
    },

    addMeetingEntry(meetingId, entry) {
      return db.$transaction(async (tx) => {
        const meeting = await tx.meeting.findUniqueOrThrow({
          where: { id: meetingId },
        });
        const exists = await tx.meetingEntry.findFirst({
          where: { meetingId, kind: entry.kind, entryOrder: entry.order },
        });
        if (exists) return;
        const sequence =
          entry.kind === "STATEMENT"
            ? await appendRunEvent(tx, meeting.runId, {
                type: "meeting.statement",
                summary: entry.summary,
                role: entry.role,
                refs: { meetingId },
                data: { meetingId, order: entry.order },
              })
            : await appendRunEvent(tx, meeting.runId, {
                type: "meeting.reaction",
                summary: "반응",
                role: entry.role,
                refs: { meetingId },
                data: { meetingId, kind: entry.reaction },
              });
        await tx.meetingEntry.create({
          data:
            entry.kind === "STATEMENT"
              ? {
                  meetingId,
                  kind: "STATEMENT",
                  entryOrder: entry.order,
                  eventSequence: sequence,
                  role: entry.role,
                  text: entry.summary,
                }
              : {
                  meetingId,
                  kind: "REACTION",
                  entryOrder: entry.order,
                  eventSequence: sequence,
                  role: entry.role,
                  reactionKind: entry.reaction,
                },
        });
      });
    },

    endMeeting(meetingId, outcome, summary) {
      return db.$transaction(async (tx) => {
        const ended = await tx.meeting.updateMany({
          where: {
            id: meetingId,
            status: { in: ["IN_PROGRESS", "WAITING_CEO"] },
          },
          data: {
            status: MEETING_STATUS[outcome],
            outcome: summary,
            endedAt: new Date(),
          },
        });
        if (ended.count === 0) return;
        const meeting = await tx.meeting.findUniqueOrThrow({
          where: { id: meetingId },
        });
        await appendRunEvent(tx, meeting.runId, {
          type: "meeting.ended",
          summary: `${meeting.topic} 회의를 마쳤어요. ${summary}`.trim(),
          refs: { meetingId },
          data: { meetingId, outcome },
        });
      });
    },

    async endMeetingOfDecision(decisionId, summary) {
      const meeting = await db.meeting.findFirst({
        where: { decisionId, status: { in: ["IN_PROGRESS", "WAITING_CEO"] } },
        select: { id: true },
      });
      if (meeting) await this.endMeeting(meeting.id, "DECIDED", summary);
    },
  };
}
