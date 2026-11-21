import type { PrismaClient } from "@prisma/client";
import type { OfficeRepository } from "@/application/ports";
import type { Meeting, MeetingSummary, RoleId } from "@/contracts";
import {
  deriveRoleStates,
  isNewsworthy,
  type RoleActivity,
} from "@/domain/office";
import { WORKSPACE_ID } from "@/lib/db";
import {
  decisionInclude,
  projectInclude,
  runInclude,
  toDecisionSummary,
  toProjectSummary,
  toRun,
} from "@/infrastructure/prisma/mappers";

type MeetingRow = {
  id: string;
  runId: string;
  decisionId: string | null;
  topic: string;
  participants: RoleId[];
  status: MeetingSummary["status"];
};

const toMeetingSummary = (row: MeetingRow): MeetingSummary => ({
  id: row.id,
  runId: row.runId,
  decisionId: row.decisionId,
  topic: row.topic,
  participants: row.participants,
  status: row.status,
});

export function createOfficeRepository(db: PrismaClient): OfficeRepository {
  return {
    async officeState(projectId) {
      const project = await db.project.findFirst({
        where: { id: projectId, workspaceId: WORKSPACE_ID },
        include: projectInclude,
      });
      if (!project) return null;
      const latest = await db.run.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        include: runInclude,
      });
      const base = { project: toProjectSummary(project) };
      if (!latest)
        return {
          ...base,
          run: null,
          roles: deriveRoleStates(null, {}, {}),
          activeMeeting: null,
          openDecisions: [],
          latestNews: null,
          lastSequence: 0,
        };

      const [stepEvents, artifacts, decisions, meeting, newsEvents] =
        await Promise.all([
          db.runEvent.findMany({
            where: {
              runId: latest.id,
              role: { not: null },
              type: { in: ["step.started", "step.completed"] },
            },
            orderBy: { sequence: "desc" },
            take: 200,
          }),
          db.artifact.findMany({
            where: { runId: latest.id, author: { not: "SYSTEM" } },
            orderBy: { createdAt: "desc" },
          }),
          db.decision.findMany({
            where: { runId: latest.id, status: "OPEN" },
            orderBy: { createdAt: "asc" },
            include: decisionInclude,
          }),
          db.meeting.findFirst({
            where: {
              runId: latest.id,
              status: { in: ["IN_PROGRESS", "WAITING_CEO"] },
            },
            orderBy: { startedAt: "desc" },
          }),
          db.runEvent.findMany({
            where: { runId: latest.id },
            orderBy: { sequence: "desc" },
            take: 20,
          }),
        ]);

      const lastActivity: Partial<Record<RoleId, RoleActivity>> = {};
      for (const event of stepEvents)
        if (event.role && !lastActivity[event.role])
          lastActivity[event.role] = {
            type: event.type as RoleActivity["type"],
            summary: event.summary,
          };
      const latestArtifactId: Partial<Record<RoleId, string>> = {};
      for (const artifact of artifacts)
        if (artifact.author !== "SYSTEM" && !latestArtifactId[artifact.author])
          latestArtifactId[artifact.author] = artifact.id;
      const news = newsEvents.find(
        (event) => isNewsworthy(event.type) && event.summary,
      );

      return {
        ...base,
        run: toRun(latest),
        roles: deriveRoleStates(latest, lastActivity, latestArtifactId),
        activeMeeting: meeting ? toMeetingSummary(meeting) : null,
        openDecisions: decisions.map(toDecisionSummary),
        latestNews: news
          ? { sequence: news.sequence, role: news.role, text: news.summary }
          : null,
        lastSequence: latest.lastSequence,
      };
    },

    async meetings(runId) {
      const run = await db.run.findFirst({
        where: { id: runId, project: { workspaceId: WORKSPACE_ID } },
        select: { id: true },
      });
      if (!run) return null;
      const rows = await db.meeting.findMany({
        where: { runId },
        orderBy: { startedAt: "asc" },
      });
      return rows.map(toMeetingSummary);
    },

    async meeting(id): Promise<Meeting | null> {
      const row = await db.meeting.findFirst({
        where: { id, run: { project: { workspaceId: WORKSPACE_ID } } },
        include: { entries: { orderBy: { entryOrder: "asc" } } },
      });
      if (!row) return null;
      return {
        ...toMeetingSummary(row),
        statements: row.entries
          .filter((entry) => entry.kind === "STATEMENT")
          .map((entry) => ({
            order: entry.entryOrder,
            sequence: entry.eventSequence,
            role: entry.role,
            summary: entry.text ?? "",
          })),
        reactions: row.entries
          .filter((entry) => entry.kind === "REACTION")
          .map((entry) => ({
            sequence: entry.eventSequence,
            role: entry.role,
            kind: (entry.reactionKind ??
              "NOD") as Meeting["reactions"][number]["kind"],
          })),
        outcome: row.outcome,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      };
    },
  };
}
