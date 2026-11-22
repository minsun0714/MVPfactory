import type { PrismaClient } from "@prisma/client";
import type { VerificationStore } from "@/application/build-verification";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";

export function createVerificationStore(db: PrismaClient): VerificationStore {
  return {
    async latestItems(runId, sourceDigest) {
      const report = await db.verificationReport.findFirst({
        where: { runId, sourceDigest },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      });
      return (report?.items ?? []).map((item) => ({
        checkId: item.checkId,
        description: item.description,
        result: item.result,
        evidence: item.evidence,
        reason: item.reason,
      }));
    },

    saveReport(input) {
      return db.$transaction(async (tx) => {
        const report = await tx.verificationReport.create({
          data: {
            runId: input.runId,
            specVersion: input.specVersion,
            sourceDigest: input.sourceDigest,
            harnessVersion: input.harnessVersion,
            commitSha: input.commitSha ?? null,
            deploymentId: input.deploymentId ?? null,
            items: {
              create: input.items.map((item) => ({
                checkId: item.checkId,
                description: item.description,
                result: item.result,
                evidence: item.evidence,
                reason: item.reason,
              })),
            },
          },
        });
        const counts = { PASS: 0, FAIL: 0, NOT_RUN: 0, NOT_APPLICABLE: 0 };
        for (const item of input.items) counts[item.result] += 1;
        await appendRunEvent(tx, input.runId, {
          type: "verification.recorded",
          summary: `검증 결과를 기록했어요. 통과 ${counts.PASS}, 실패 ${counts.FAIL}, 미실행 ${counts.NOT_RUN}`,
          data: { reportId: report.id, counts },
        });
        return report.id;
      });
    },
  };
}
