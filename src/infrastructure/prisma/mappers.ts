/**
 * Prisma 행 → API 계약 변환. Prisma 타입은 이 폴더 밖으로 내보내지 않는다.
 */
import type { Prisma } from "@prisma/client";
import type {
  Artifact,
  ArtifactSummary,
  Decision,
  DecisionSummary,
  Project,
  ProjectSummary,
  Run,
  RunEvent,
  RunLimits,
} from "@/contracts";

export const runInclude = {
  decisions: { where: { status: "OPEN" }, select: { id: true } },
} satisfies Prisma.RunInclude;
export type RunRow = Prisma.RunGetPayload<{ include: typeof runInclude }>;

export const projectInclude = {
  runs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    include: { decisions: { where: { status: "OPEN" }, select: { id: true } } },
  },
  specs: { orderBy: { version: "desc" }, take: 1 },
} satisfies Prisma.ProjectInclude;
export type ProjectRow = Prisma.ProjectGetPayload<{
  include: typeof projectInclude;
}>;

export const decisionInclude = {
  run: { select: { projectId: true } },
} satisfies Prisma.DecisionInclude;
export type DecisionRow = Prisma.DecisionGetPayload<{
  include: typeof decisionInclude;
}>;

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);

export function readLimits(value: Prisma.JsonValue): RunLimits {
  const record = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  const num = (key: string) =>
    typeof record[key] === "number" ? (record[key] as number) : null;
  return {
    maxModelCalls: num("maxModelCalls"),
    maxFixAttempts: num("maxFixAttempts"),
    maxActiveSeconds: num("maxActiveSeconds"),
    maxEstimatedCost: num("maxEstimatedCost"),
  };
}

export function toRun(row: RunRow): Run {
  const failure = row.failure as Run["failure"] | null;
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    mode: row.mode,
    status: row.status,
    stage:
      row.stageId && row.stageLabel
        ? { id: row.stageId, label: row.stageLabel }
        : null,
    ceoLevel: row.ceoLevel,
    blockedReason: row.blockedReason,
    failure: failure ?? null,
    pauseRequested: row.pauseRequested,
    openDecisionIds: row.decisions.map((decision) => decision.id),
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
    limits: readLimits(row.limits),
    lastSequence: row.lastSequence,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    createdAt: iso(row.createdAt),
  };
}

export function toProjectSummary(row: ProjectRow): ProjectSummary {
  const latest = row.runs[0];
  return {
    id: row.id,
    name: row.name,
    archived: row.archivedAt !== null,
    latestRun: latest
      ? { id: latest.id, status: latest.status, mode: latest.mode }
      : null,
    hasOpenDecision: (latest?.decisions.length ?? 0) > 0,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toProject(row: ProjectRow): Project {
  const spec = row.specs[0];
  return {
    ...toProjectSummary(row),
    idea: row.idea,
    purpose: row.purpose,
    constraints: row.constraints,
    ceoLevel: row.ceoLevel,
    confirmedSpec:
      spec && spec.version === row.confirmedSpecVersion
        ? { version: spec.version, summary: spec.summary }
        : null,
    hasLiveApp: row.lastGoodDeploymentId !== null,
  };
}

export function toDecisionSummary(row: DecisionRow): DecisionSummary {
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.run.projectId,
    kind: row.kind,
    status: row.status,
    proposalVersion: row.proposalVersion,
    title: row.title,
    openedAt: isoOrNull(row.openedAt),
  };
}

export function toDecision(row: DecisionRow): Decision {
  return {
    ...toDecisionSummary(row),
    summary: row.summary,
    proposal: row.proposal as Decision["proposal"],
    changesFromPrevious: row.changesFromPrevious as string[],
    options: row.options as Decision["options"],
    response:
      row.responseChoice && row.answeredAt
        ? {
            choice: row.responseChoice,
            optionId: row.responseOptionId,
            comment: row.responseComment,
            answeredAt: iso(row.answeredAt),
          }
        : null,
    appliedAt: isoOrNull(row.appliedAt),
  };
}

export type ArtifactRow = Prisma.ArtifactGetPayload<Record<string, never>>;

export function toArtifactSummary(row: ArtifactRow): ArtifactSummary {
  return {
    id: row.id,
    runId: row.runId,
    author: row.author,
    type: row.type,
    title: row.title,
    createdAt: iso(row.createdAt),
  };
}

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    ...toArtifactSummary(row),
    content: (row.content as Artifact["content"]) ?? null,
    // 큰 파일의 서명된 다운로드 링크는 객체 저장소를 정한 뒤(DEC-007) 만든다.
    downloadUrl: null,
  };
}

export type RunEventRow = Prisma.RunEventGetPayload<Record<string, never>>;

/** 이벤트 종류와 `data`의 대응은 쓰는 시점에 `RunEventDataMap`으로 검증한다. */
export function toRunEvent(row: RunEventRow): RunEvent {
  return {
    runId: row.runId,
    sequence: row.sequence,
    type: row.type,
    occurredAt: iso(row.occurredAt),
    stage: row.stageId,
    role: row.role,
    summary: row.summary,
    refs: row.refs as RunEvent["refs"],
    data: row.data,
  } as RunEvent;
}
