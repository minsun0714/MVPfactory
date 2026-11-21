import type { PrismaClient } from "@prisma/client";
import type { WorkspaceFeedRepository } from "@/application/ports";
import type { RunEventDataMap, WorkspaceEvent } from "@/contracts";
import { WORKSPACE_ID } from "@/lib/db";
import {
  decisionInclude,
  toDecisionSummary,
} from "@/infrastructure/prisma/mappers";

const DECISION_TYPES = [
  "decision.opened",
  "decision.answered",
  "decision.applied",
] as const;
type DecisionType = (typeof DECISION_TYPES)[number];

export function createWorkspaceFeedRepository(
  db: PrismaClient,
): WorkspaceFeedRepository {
  return {
    async snapshotCursors() {
      const runs = await db.run.findMany({
        where: { project: { workspaceId: WORKSPACE_ID } },
        select: { id: true, lastSequence: true },
      });
      return new Map(runs.map((run) => [run.id, run.lastSequence]));
    },

    async changesAfter(runId, after) {
      const run = await db.run.findFirst({
        where: { id: runId, project: { workspaceId: WORKSPACE_ID } },
        select: { projectId: true },
      });
      if (!run) return { events: [], lastSequence: after };
      const rows = await db.runEvent.findMany({
        where: {
          runId,
          sequence: { gt: after },
          type: { in: [...DECISION_TYPES, "run.status_changed"] },
        },
        orderBy: { sequence: "asc" },
      });
      const events: WorkspaceEvent[] = [];
      for (const row of rows) {
        const occurredAt = row.occurredAt.toISOString();
        if (row.type === "run.status_changed") {
          const data =
            row.data as unknown as RunEventDataMap["run.status_changed"];
          events.push({
            type: "run.status_changed",
            occurredAt,
            projectId: run.projectId,
            runId,
            status: data.to,
            blockedReason: data.blockedReason ?? null,
          });
        } else {
          const decisionId = (row.refs as { decisionId?: string }).decisionId;
          const decision = decisionId
            ? await db.decision.findUnique({
                where: { id: decisionId },
                include: decisionInclude,
              })
            : null;
          if (decision)
            events.push({
              type: row.type as DecisionType,
              occurredAt,
              decision: toDecisionSummary(decision),
            });
        }
      }
      const last = await db.runEvent.findFirst({
        where: { runId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      return { events, lastSequence: last?.sequence ?? after };
    },
  };
}
