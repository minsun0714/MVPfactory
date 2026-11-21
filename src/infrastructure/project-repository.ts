import { db } from "@/lib/db";
import { decisionOutcome } from "@/domain/requests";
import type { NewProject, DecisionOutcome } from "@/domain/requests";

export const projectRepository = {
  async list(ownerId: string) {
    return db.project.findMany({
      where: { ownerId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    });
  },
  async find(id: string, ownerId: string) {
    return db.project.findFirst({
      where: { id, ownerId },
      include: {
        resources: true,
        runs: {
          orderBy: { createdAt: "desc" },
          include: {
            artifacts: { orderBy: { createdAt: "asc" } },
            decisions: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    });
  },
  async create(input: NewProject, ownerId: string) {
    return db.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: ownerId },
        create: { id: ownerId },
        update: {},
      });
      return tx.project.create({
        data: {
          name: input.name,
          idea: input.idea,
          requirements: input.idea,
          ceoLevel: input.ceoLevel,
          ownerId,
          runs: { create: { mode: "DEMO" } },
        },
        include: { runs: true },
      });
    });
  },
  async answer(
    id: string,
    response: string,
    ownerId: string,
  ): Promise<DecisionOutcome> {
    return db.$transaction(async (tx) => {
      const decision = await tx.decision.findFirst({
        where: { id, run: { project: { ownerId } } },
        include: { run: true },
      });
      if (!decision) return "missing";
      const outcome = decisionOutcome(
        { ...decision, runStatus: decision.run.status },
        response,
      );
      // A related Run may already be requeued by an identical concurrent answer.
      // Only the conditional write can decide whether a pending decision is still answerable.
      if (decision.status === "ANSWERED")
        return outcome === "accepted" ? "accepted" : "conflict";
      const updated = await tx.decision.updateMany({
        where: { id, status: "PENDING", run: { status: "WAITING" } },
        data: { status: "ANSWERED", response, answeredAt: new Date() },
      });
      if (!updated.count) {
        const current = await tx.decision.findUniqueOrThrow({ where: { id } });
        return current.status === "ANSWERED" && current.response === response
          ? "accepted"
          : "conflict";
      }
      await tx.run.update({
        where: { id: decision.runId },
        data: { status: "QUEUED", stage: "CEO 응답 접수" },
      });
      return "accepted";
    });
  },
};
