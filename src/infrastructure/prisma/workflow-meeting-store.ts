import type { PrismaClient } from "@prisma/client";
import type { MeetingDraft, WorkflowStore } from "@/application/workflow-ports";
import type { MeetingOutcome } from "@/contracts";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";

const MEETING_STATUS: Record<
  MeetingOutcome,
  "ENDED" | "WAITING_CEO" | "FAILED" | "INTERRUPTED"
> = {
  DECIDED: "ENDED",
  WAITING_CEO: "WAITING_CEO",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
};

export function createWorkflowMeetingStore(
  db: PrismaClient,
): Pick<
  WorkflowStore,
  "startMeeting" | "addMeetingEntry" | "endMeeting" | "endMeetingOfDecision"
> {
  return {
    // ── 회의
    startMeeting(draft: MeetingDraft) {
      return db.$transaction(async (tx) => {
        const existing = await tx.meeting.findFirst({
          where: draft.decisionId
            ? { runId: draft.runId, decisionId: draft.decisionId }
            : { runId: draft.runId, topic: draft.topic },
        });
        if (existing) return { id: existing.id, created: false };
        const meeting = await tx.meeting.create({
          data: {
            runId: draft.runId,
            decisionId: draft.decisionId,
            topic: draft.topic,
            participants: draft.participants,
            startedAt: new Date(),
          },
        });
        await appendRunEvent(tx, draft.runId, {
          type: "meeting.started",
          summary: `${draft.topic} 회의를 시작했어요.`,
          refs: {
            meetingId: meeting.id,
            ...(draft.decisionId ? { decisionId: draft.decisionId } : {}),
          },
          data: {
            meetingId: meeting.id,
            topic: draft.topic,
            participants: draft.participants,
          },
        });
        return { id: meeting.id, created: true };
      });
    },

    addMeetingEntry(meetingId, entry) {
      return db.$transaction(async (tx) => {
        const meeting = await tx.meeting.findUniqueOrThrow({
          where: { id: meetingId },
        });
        const exists = await tx.meetingEntry.findFirst({
          where: { meetingId, kind: entry.kind, entryOrder: entry.order },
        });
        if (exists) return;
        const sequence =
          entry.kind === "STATEMENT"
            ? await appendRunEvent(tx, meeting.runId, {
                type: "meeting.statement",
                summary: entry.summary,
                role: entry.role,
                refs: { meetingId },
                data: { meetingId, order: entry.order },
              })
            : await appendRunEvent(tx, meeting.runId, {
                type: "meeting.reaction",
                summary: "반응",
                role: entry.role,
                refs: { meetingId },
                data: { meetingId, kind: entry.reaction },
              });
        await tx.meetingEntry.create({
          data:
            entry.kind === "STATEMENT"
              ? {
                  meetingId,
                  kind: "STATEMENT",
                  entryOrder: entry.order,
                  eventSequence: sequence,
                  role: entry.role,
                  text: entry.summary,
                }
              : {
                  meetingId,
                  kind: "REACTION",
                  entryOrder: entry.order,
                  eventSequence: sequence,
                  role: entry.role,
                  reactionKind: entry.reaction,
                },
        });
      });
    },

    endMeeting(meetingId, outcome, summary) {
      return db.$transaction(async (tx) => {
        const ended = await tx.meeting.updateMany({
          where: {
            id: meetingId,
            status: { in: ["IN_PROGRESS", "WAITING_CEO"] },
          },
          data: {
            status: MEETING_STATUS[outcome],
            outcome: summary,
            endedAt: new Date(),
          },
        });
        if (ended.count === 0) return;
        const meeting = await tx.meeting.findUniqueOrThrow({
          where: { id: meetingId },
        });
        await appendRunEvent(tx, meeting.runId, {
          type: "meeting.ended",
          summary: `${meeting.topic} 회의를 마쳤어요. ${summary}`.trim(),
          refs: { meetingId },
          data: { meetingId, outcome },
        });
      });
    },

    async endMeetingOfDecision(decisionId, summary) {
      const meeting = await db.meeting.findFirst({
        where: { decisionId, status: { in: ["IN_PROGRESS", "WAITING_CEO"] } },
        select: { id: true },
      });
      if (meeting) await this.endMeeting(meeting.id, "DECIDED", summary);
    },
  };
}
