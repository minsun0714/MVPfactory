import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ArtifactInput,
  StoredArtifact,
  WorkflowStore,
} from "@/application/workflow-ports";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import { hashRequest } from "@/infrastructure/prisma/idempotency";

type Tx = Prisma.TransactionClient;

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

export function createWorkflowArtifactStore(
  db: PrismaClient,
): Pick<
  WorkflowStore,
  | "beginStep"
  | "completeStep"
  | "saveArtifact"
  | "latestArtifacts"
  | "collectFeedback"
  | "freezeSpec"
> {
  return {
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
  };
}
