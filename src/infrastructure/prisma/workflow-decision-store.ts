import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  DecisionRecord,
  WorkflowStore,
} from "@/application/workflow-ports";
import type { DecisionChoice } from "@/contracts";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { hashRequest } from "@/infrastructure/prisma/idempotency";

type Tx = Prisma.TransactionClient;

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

export function createWorkflowDecisionStore(
  db: PrismaClient,
): Pick<
  WorkflowStore,
  | "prepareDecision"
  | "findDecision"
  | "findActiveDecision"
  | "openDecision"
  | "ensureWaiting"
  | "applyDecision"
  | "latestAppliedChoice"
> {
  return {
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
  };
}
