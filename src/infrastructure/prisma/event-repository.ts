import type { PrismaClient } from "@prisma/client";
import type { RunEventRepository } from "@/application/ports";
import { WORKSPACE_ID } from "@/lib/db";
import { toRunEvent } from "@/infrastructure/prisma/mappers";

export function createRunEventRepository(db: PrismaClient): RunEventRepository {
  return {
    async window(runId) {
      const run = await db.run.findFirst({
        where: { id: runId, project: { workspaceId: WORKSPACE_ID } },
        select: { lastSequence: true, eventsRetainedFrom: true },
      });
      return run
        ? {
            lastSequence: run.lastSequence,
            retainedFrom: run.eventsRetainedFrom,
          }
        : null;
    },

    async listAfter(runId, after, limit) {
      const rows = await db.runEvent.findMany({
        where: { runId, sequence: { gt: after } },
        orderBy: { sequence: "asc" },
        take: limit,
      });
      return rows.map(toRunEvent);
    },
  };
}
