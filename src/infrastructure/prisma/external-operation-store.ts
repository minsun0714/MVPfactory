import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  ExternalOperationStore,
  LedgerEntry,
} from "@/application/external-operations";

type Row = Prisma.ExternalOperationGetPayload<Record<string, never>>;

const toEntry = (row: Row): LedgerEntry => ({
  id: row.id,
  operationKey: row.operationKey,
  status: row.status,
  targetAccount: row.targetAccount,
  requestHash: row.requestHash,
  externalId: row.externalId,
  attempt: row.attempt,
});

export function createExternalOperationStore(
  db: PrismaClient,
): ExternalOperationStore {
  return {
    async begin(input) {
      const row = await db.externalOperation.upsert({
        where: { operationKey: input.operationKey },
        create: {
          operationKey: input.operationKey,
          projectId: input.projectId,
          runId: input.runId,
          provider: input.provider,
          kind: input.kind,
          targetAccount: input.targetAccount,
          requestHash: input.requestHash,
        },
        update: {},
      });
      return toEntry(row);
    },

    async claim(id, from) {
      // 상태를 조건으로 건 갱신이라 동시에 요청해도 한 곳만 외부 호출 권한을 얻는다.
      const claimed = await db.externalOperation.updateMany({
        where: { id, status: { in: from } },
        data: { status: "REQUESTED", attempt: { increment: 1 } },
      });
      if (claimed.count === 0) return null;
      return toEntry(
        await db.externalOperation.findUniqueOrThrow({ where: { id } }),
      );
    },

    async settle(id, result) {
      await db.externalOperation.update({
        where: { id },
        data: {
          status: result.status,
          observedAt: new Date(),
          ...(result.status === "SUCCEEDED"
            ? { externalId: result.externalId }
            : {}),
          ...(result.evidence !== undefined
            ? { evidence: result.evidence as Prisma.InputJsonValue }
            : {}),
        },
      });
    },

    async markInterruptedUnknown(olderThanMs) {
      const moved = await db.externalOperation.updateMany({
        where: {
          status: "REQUESTED",
          updatedAt: { lt: new Date(Date.now() - olderThanMs) },
        },
        data: { status: "UNKNOWN" },
      });
      return moved.count;
    },
  };
}
