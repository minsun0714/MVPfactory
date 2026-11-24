import type { PrismaClient } from "@prisma/client";
import type { ClaimedJob, WorkflowStore } from "@/application/workflow-ports";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";

export function createWorkflowJobStore(
  db: PrismaClient,
): Pick<
  WorkflowStore,
  "claimJob" | "finishJob" | "recoverInterruptedJobs" | "recordHeartbeat"
> {
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
  };
}
