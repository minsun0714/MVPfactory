import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Failure,
  RunSnapshot,
  WorkflowStore,
} from "@/application/workflow-ports";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { readLimits } from "@/infrastructure/prisma/mappers";

export function createWorkflowRunStore(
  db: PrismaClient,
): Pick<
  WorkflowStore,
  | "loadRun"
  | "startRun"
  | "pauseIfRequested"
  | "succeedRun"
  | "failRun"
  | "addActiveSeconds"
  | "loadUsage"
  | "recordModelCall"
  | "recordFixAttempt"
  | "specVersionOf"
  | "loadConfirmedSpec"
  | "latestSourceSnapshot"
  | "saveSourceSnapshot"
> {
  return {
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

    async loadUsage(runId) {
      const row = await db.run.findUniqueOrThrow({ where: { id: runId } });
      return {
        limits: readLimits(row.limits),
        usage: {
          modelCalls: row.usageModelCalls,
          fixAttempts: row.usageFixAttempts,
          activeSeconds: row.usageActiveSeconds,
          waitingSeconds: row.usageWaitingSeconds,
          estimatedCost:
            row.usageCostAmount !== null && row.usageCostCurrency
              ? {
                  amount: Number(row.usageCostAmount),
                  currency: row.usageCostCurrency,
                  isEstimate: true,
                }
              : null,
        },
      };
    },

    async recordModelCall(runId, call) {
      await db.$transaction([
        // 비용 합계가 비어 있으면 SQL에서 NULL + 값이 NULL이 되므로 먼저 0으로 시작한다.
        db.run.updateMany({
          where: { id: runId, usageCostAmount: null },
          data: call.costUsd === null ? {} : { usageCostAmount: 0 },
        }),
        db.run.update({
          where: { id: runId },
          data: {
            usageModelCalls: { increment: 1 },
            // 단가를 모르면 비용은 기록하지 않는다(0으로 꾸미지 않는다).
            ...(call.costUsd === null
              ? {}
              : {
                  usageCostAmount: { increment: call.costUsd },
                  usageCostCurrency: "USD",
                }),
          },
        }),
        db.usageRecord.create({
          data: {
            runId,
            kind: "MODEL_CALL",
            amount: 1,
            costAmount: call.costUsd,
            costCurrency: call.costUsd === null ? null : "USD",
          },
        }),
      ]);
    },

    async recordFixAttempt(runId) {
      await db.$transaction([
        db.run.update({
          where: { id: runId },
          data: { usageFixAttempts: { increment: 1 } },
        }),
        db.usageRecord.create({
          data: { runId, kind: "FIX_ATTEMPT", amount: 1 },
        }),
      ]);
    },

    async specVersionOf(runId) {
      const spec = await db.productSpec.findFirst({
        where: { createdByRunId: runId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      return spec?.version ?? null;
    },

    async loadConfirmedSpec(runId) {
      const spec = await db.productSpec.findFirst({
        where: { createdByRunId: runId },
        orderBy: { version: "desc" },
        select: { version: true, content: true },
      });
      if (!spec) return null;
      const content = spec.content;
      return {
        version: spec.version,
        content:
          content && typeof content === "object" && !Array.isArray(content)
            ? (content as Record<string, unknown>)
            : {},
      };
    },

    async latestSourceSnapshot(runId) {
      return db.sourceSnapshot.findFirst({
        where: { runId },
        orderBy: { createdAt: "desc" },
        select: { sourceDigest: true, storageRef: true },
      });
    },

    async saveSourceSnapshot(runId, snapshot) {
      await db.sourceSnapshot.upsert({
        where: {
          runId_sourceDigest: { runId, sourceDigest: snapshot.sourceDigest },
        },
        create: { runId, templateVersion: "generated-v1", ...snapshot },
        update: {},
      });
    },
  };
}
