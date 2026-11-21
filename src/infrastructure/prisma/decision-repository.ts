import type { PrismaClient } from "@prisma/client";
import type { DecisionRepository } from "@/application/ports";
import type { DecisionOption } from "@/contracts";
import { AppError } from "@/domain/errors";
import {
  evaluateDecisionResponse,
  type DecisionState,
} from "@/domain/decisions";
import { WORKSPACE_ID } from "@/lib/db";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";
import {
  decisionInclude,
  toDecision,
  toDecisionSummary,
  type DecisionRow,
} from "@/infrastructure/prisma/mappers";

function stateOf(row: DecisionRow): DecisionState {
  return {
    kind: row.kind,
    status: row.status,
    proposalVersion: row.proposalVersion,
    optionIds: (row.options as DecisionOption[]).map((option) => option.id),
    response: row.responseChoice
      ? {
          choice: row.responseChoice,
          optionId: row.responseOptionId,
          comment: row.responseComment,
        }
      : null,
  };
}

export function createDecisionRepository(db: PrismaClient): DecisionRepository {
  const scope = { run: { project: { workspaceId: WORKSPACE_ID } } };

  return {
    async list(query) {
      const rows = await db.decision.findMany({
        where: {
          ...scope,
          ...(query.status ? { status: query.status } : {}),
          ...(query.projectId
            ? {
                run: {
                  projectId: query.projectId,
                  project: { workspaceId: WORKSPACE_ID },
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: decisionInclude,
      });
      const items = rows.slice(0, query.limit);
      return {
        items: items.map(toDecisionSummary),
        nextCursor:
          rows.length > query.limit ? items[items.length - 1].id : null,
      };
    },

    async find(id) {
      const row = await db.decision.findFirst({
        where: { id, ...scope },
        include: decisionInclude,
      });
      return row ? toDecision(row) : null;
    },

    respond(id, request) {
      return db.$transaction(async (tx) => {
        const load = () =>
          tx.decision.findFirst({
            where: { id, ...scope },
            include: { ...decisionInclude, run: true },
          });
        const decision = await load();
        if (!decision)
          throw new AppError("NOT_FOUND", "결정을 찾을 수 없습니다.");

        const verdict = evaluateDecisionResponse(
          stateOf(decision),
          decision.run,
          request,
        );
        if (verdict === "replay") return toDecision(decision);

        // 1) Run을 조건부로 재개 대기로 돌린다. 이 갱신이 Run 행을 잠가 동시 응답을 한 줄로 세운다.
        const claimed = await tx.run.updateMany({
          where: {
            id: decision.runId,
            status: "WAITING_CEO",
            pauseRequested: false,
          },
          data: { status: "QUEUED" },
        });
        if (claimed.count === 0) {
          // 다른 요청이 먼저 처리했거나 정지 요청이 들어왔다. 최신 상태로 다시 판단한다.
          const fresh = await load();
          if (!fresh)
            throw new AppError("NOT_FOUND", "결정을 찾을 수 없습니다.");
          if (
            evaluateDecisionResponse(stateOf(fresh), fresh.run, request) ===
            "replay"
          )
            return toDecision(fresh);
          throw new AppError(
            "DECISION_NOT_OPEN",
            "지금은 응답할 수 없는 결정입니다.",
          );
        }

        // 2) 결정을 조건부로 ANSWERED로 바꾼다. 실패하면 전체를 되돌린다.
        const marked = await tx.decision.updateMany({
          where: {
            id,
            status: "OPEN",
            proposalVersion: request.proposalVersion,
          },
          data: {
            status: "ANSWERED",
            responseChoice: request.choice,
            responseOptionId: request.optionId ?? null,
            responseComment: request.comment ?? null,
            answeredAt: new Date(),
          },
        });
        if (marked.count === 0)
          throw new AppError(
            "DECISION_NOT_OPEN",
            "지금은 응답할 수 없는 결정입니다.",
          );

        // 3) 재개 Job과 이벤트를 같은 트랜잭션에 남긴다. 응답과 재개 요청 중 하나만 남는 일은 없다.
        await tx.job.create({
          data: {
            runId: decision.runId,
            kind: "RESUME",
            dedupeKey: `resume:${id}`,
          },
        });
        await appendRunEvent(tx, decision.runId, {
          type: "decision.answered",
          summary: "CEO 응답이 접수되었습니다.",
          refs: { decisionId: id },
          data: { decisionId: id, choice: request.choice },
        });
        await appendRunEvent(tx, decision.runId, {
          type: "run.status_changed",
          summary: "응답이 접수되어 실행이 재개를 기다립니다.",
          data: { from: "WAITING_CEO", to: "QUEUED", blockedReason: null },
        });

        const saved = await load();
        return toDecision(saved!);
      });
    },
  };
}
