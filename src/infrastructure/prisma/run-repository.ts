import { workspaceRunLimits } from "@/infrastructure/integrations/default-limits";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { RunRepository } from "@/application/ports";
import type { Run } from "@/contracts";
import { AppError } from "@/domain/errors";
import {
  assertCanStartRun,
  decidePause,
  decideResume,
  decideRetry,
} from "@/domain/runs";
import { EMPTY_USAGE, reachedLimit } from "@/domain/limits";
import { WORKSPACE_ID } from "@/lib/db";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import {
  isUniqueViolation,
  runIdempotent,
} from "@/infrastructure/prisma/idempotency";
import {
  readLimits,
  runInclude,
  toArtifact,
  toArtifactSummary,
  toRun,
} from "@/infrastructure/prisma/mappers";

/** 워크플로우가 만들어지기 전까지의 자리 표시 버전. 실제 워크플로우가 생기면 그 버전을 기록한다. */
const WORKFLOW_VERSION = "unreleased";
const PROMPT_VERSION = "none";

async function startInTransaction(
  tx: Prisma.TransactionClient,
  projectId: string,
  request: {
    type: "INITIAL" | "REVISION";
    mode: "REAL" | "DEMO";
    ceoLevel: Run["ceoLevel"];
    feedback?: string;
  },
): Promise<Run> {
  const project = await tx.project.findFirst({
    where: { id: projectId, workspaceId: WORKSPACE_ID },
  });
  if (!project) throw new AppError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

  const [totalRuns, succeededRuns] = await Promise.all([
    tx.run.count({ where: { projectId } }),
    tx.run.count({ where: { projectId, status: "SUCCEEDED" } }),
  ]);
  assertCanStartRun({
    type: request.type,
    archived: project.archivedAt !== null,
    totalRuns,
    succeededRuns,
  });

  const workspace = await tx.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID },
    update: {},
  });
  const limits = { ...workspaceRunLimits(workspace) };
  // 시작하기 전부터 한도가 0이면(허용하지 않음) 실행을 만들지 않는다.
  const reached = reachedLimit(limits, EMPTY_USAGE);
  if (reached)
    throw new AppError(
      "LIMIT_REACHED",
      `${reached} 한도가 0이라 실행을 시작할 수 없어요. 설정에서 한도를 확인하세요.`,
    );

  const { projectGeneration } = await tx.project.update({
    where: { id: projectId },
    data: { projectGeneration: { increment: 1 } },
    select: { projectGeneration: true },
  });

  const id = randomUUID();
  await tx.run.create({
    data: {
      id,
      projectId,
      type: request.type,
      mode: request.mode,
      ceoLevel: request.ceoLevel,
      feedback: request.feedback ?? null,
      projectGeneration,
      baseSpecVersion: project.confirmedSpecVersion,
      workflowVersion: WORKFLOW_VERSION,
      promptVersion: PROMPT_VERSION,
      modelConfig: {},
      limits,
      threadId: id,
    },
  });
  // 작업 공간당 열린 Run은 하나다. 기본키 충돌은 호출한 쪽에서 ACTIVE_RUN_EXISTS로 바꾼다.
  await tx.activeRunLock.create({
    data: { workspaceId: WORKSPACE_ID, runId: id },
  });
  await tx.job.create({
    data: { runId: id, kind: "START", dedupeKey: `start:${id}` },
  });
  await appendRunEvent(tx, id, {
    type: "run.accepted",
    summary:
      request.type === "REVISION"
        ? "수정 실행이 접수되었습니다."
        : "실행이 접수되었습니다.",
    data: { projectId, ceoLevel: request.ceoLevel, limits: readLimits(limits) },
  });

  const row = await tx.run.findUniqueOrThrow({
    where: { id },
    include: runInclude,
  });
  return toRun(row);
}

const scoped = (id: string) => ({ id, project: { workspaceId: WORKSPACE_ID } });
const MAX_ATTEMPTS = 3;

async function loadRun(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.run.findFirst({
    where: scoped(id),
    include: runInclude,
  });
  if (!row) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
  return row;
}

async function pauseInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<Run> {
  // 판단한 뒤 상태가 바뀌었을 수 있으므로(예: 대기 중이던 Run을 워커가 시작) 조건부 갱신이 실패하면 다시 판단한다.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const run = await loadRun(tx, id);
    const decision = decidePause(run);
    if (decision === "already") return toRun(run);
    if (decision === "request") {
      const updated = await tx.run.updateMany({
        where: { id, status: "RUNNING", pauseRequested: false },
        data: { pauseRequested: true },
      });
      if (updated.count === 1) {
        await appendRunEvent(tx, id, {
          type: "run.pause_requested",
          summary: "일시정지를 요청했습니다. 안전한 지점에서 멈춥니다.",
          data: {},
        });
        return toRun(await loadRun(tx, id));
      }
    } else {
      const updated = await tx.run.updateMany({
        where: { id, status: { in: ["QUEUED", "WAITING_CEO", "BLOCKED"] } },
        data: { status: "PAUSED" },
      });
      if (updated.count === 1) {
        await appendRunEvent(tx, id, {
          type: "run.pause_requested",
          summary: "일시정지를 요청했습니다.",
          data: {},
        });
        await appendRunEvent(tx, id, {
          type: "run.paused",
          summary: "실행이 일시정지되었습니다.",
          data: {},
        });
        await appendRunEvent(tx, id, {
          type: "run.status_changed",
          summary: "일시정지",
          data: {
            from: run.status,
            to: "PAUSED",
            blockedReason: run.blockedReason,
          },
        });
        return toRun(await loadRun(tx, id));
      }
    }
  }
  return toRun(await loadRun(tx, id));
}

async function resumeInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<Run> {
  const run = await loadRun(tx, id);
  const decision = decideResume({
    status: run.status,
    pauseRequested: run.pauseRequested,
    blockedReason: run.blockedReason,
    hasOpenDecision: run.decisions.length > 0,
  });
  if (decision === "already") return toRun(run);
  if (decision === "cancel-request") {
    await tx.run.updateMany({
      where: { id, pauseRequested: true },
      data: { pauseRequested: false },
    });
    return toRun(await loadRun(tx, id));
  }
  const target: "BLOCKED" | "WAITING_CEO" | "QUEUED" =
    decision === "to-blocked"
      ? "BLOCKED"
      : decision === "to-waiting"
        ? "WAITING_CEO"
        : "QUEUED";
  const updated = await tx.run.updateMany({
    where: { id, status: "PAUSED" },
    data: { status: target },
  });
  if (updated.count === 1) {
    if (target === "QUEUED")
      await tx.job.create({
        data: {
          runId: id,
          kind: "RESUME",
          dedupeKey: `resume-pause:${randomUUID()}`,
        },
      });
    await appendRunEvent(tx, id, {
      type: "run.status_changed",
      summary: "일시정지를 해제했습니다.",
      data: { from: "PAUSED", to: target, blockedReason: run.blockedReason },
    });
  }
  return toRun(await loadRun(tx, id));
}

async function retryInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<Run> {
  const run = await loadRun(tx, id);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: run.projectId },
    select: { projectGeneration: true },
  });
  const decision = decideRetry({
    status: run.status,
    projectGeneration: run.projectGeneration,
    latestProjectGeneration: project.projectGeneration,
  });
  if (decision === "already") return toRun(run);

  const updated = await tx.run.updateMany({
    where: { id, status: "FAILED" },
    data: {
      status: "QUEUED",
      failure: Prisma.DbNull,
      finishedAt: null,
      blockedReason: null,
    },
  });
  if (updated.count === 0) {
    // 동시에 다른 요청이 먼저 재시도했다면 같은 결과를 돌려준다.
    const current = await loadRun(tx, id);
    if (current.status === "QUEUED" || current.status === "RUNNING")
      return toRun(current);
    throw new AppError(
      "INVALID_RUN_STATE",
      "실패한 실행만 다시 시도할 수 있습니다.",
    );
  }
  // 종료 때 풀린 열린 Run 예약을 다시 잡는다. 이미 다른 Run이 잡고 있으면 이 트랜잭션 전체가 되돌아간다.
  await tx.activeRunLock.create({
    data: { workspaceId: WORKSPACE_ID, runId: id },
  });
  const failedJob = await tx.job.findFirst({
    where: { runId: id, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  await tx.job.create({
    data: {
      runId: id,
      kind: "RECOVER",
      dedupeKey: `retry:${randomUUID()}`,
      causeJobId: failedJob?.id ?? null,
    },
  });
  await appendRunEvent(tx, id, {
    type: "run.status_changed",
    summary: "실패한 실행을 다시 시도합니다.",
    data: { from: "FAILED", to: "QUEUED", blockedReason: null },
  });
  return toRun(await loadRun(tx, id));
}

async function withActiveRunConflict<T>(
  db: PrismaClient,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isUniqueViolation(error, "ActiveRunLock")) throw error;
    const lock = await db.activeRunLock.findUnique({
      where: { workspaceId: WORKSPACE_ID },
    });
    throw new AppError("ACTIVE_RUN_EXISTS", "이미 진행 중인 실행이 있습니다.", {
      details: { runId: lock?.runId ?? "" },
    });
  }
}

export function createRunRepository(db: PrismaClient): RunRepository {
  return {
    async start(projectId, input) {
      try {
        return await runIdempotent<Run>(
          db,
          {
            scope: `POST /api/projects/${projectId}/runs`,
            key: input.key,
            request: input.request,
            status: 202,
          },
          (tx) => startInTransaction(tx, projectId, input.request),
        );
      } catch (error) {
        if (!isUniqueViolation(error, "ActiveRunLock")) throw error;
        const lock = await db.activeRunLock.findUnique({
          where: { workspaceId: WORKSPACE_ID },
        });
        throw new AppError(
          "ACTIVE_RUN_EXISTS",
          "이미 진행 중인 실행이 있습니다.",
          {
            details: { runId: lock?.runId ?? "" },
          },
        );
      }
    },

    async find(id) {
      const row = await db.run.findFirst({
        where: { id, project: { workspaceId: WORKSPACE_ID } },
        include: runInclude,
      });
      return row ? toRun(row) : null;
    },

    async listByProject(projectId, query) {
      const project = await db.project.findFirst({
        where: { id: projectId, workspaceId: WORKSPACE_ID },
        select: { id: true },
      });
      if (!project) return null;
      const rows = await db.run.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: runInclude,
      });
      const items = rows.slice(0, query.limit);
      return {
        items: items.map(toRun),
        nextCursor:
          rows.length > query.limit ? items[items.length - 1].id : null,
      };
    },

    pause: (id) => db.$transaction((tx) => pauseInTransaction(tx, id)),
    resume: (id) => db.$transaction((tx) => resumeInTransaction(tx, id)),
    retry: (id) =>
      withActiveRunConflict(db, () =>
        db.$transaction((tx) => retryInTransaction(tx, id)),
      ),

    async listArtifacts(runId) {
      const run = await db.run.findFirst({
        where: scoped(runId),
        select: { id: true },
      });
      if (!run) return null;
      const rows = await db.artifact.findMany({
        where: { runId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toArtifactSummary);
    },

    async findArtifact(id) {
      const row = await db.artifact.findFirst({
        where: { id, run: { project: { workspaceId: WORKSPACE_ID } } },
      });
      return row ? toArtifact(row) : null;
    },
  };
}
