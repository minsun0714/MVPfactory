import type { PrismaClient } from "@prisma/client";
import type { ProjectRepository } from "@/application/ports";
import type { Project } from "@/contracts";
import { WORKSPACE_ID } from "@/lib/db";
import { runIdempotent } from "@/infrastructure/prisma/idempotency";
import {
  projectInclude,
  toProject,
  toProjectSummary,
} from "@/infrastructure/prisma/mappers";

export function createProjectRepository(db: PrismaClient): ProjectRepository {
  return {
    create(input) {
      return runIdempotent<Project>(
        db,
        {
          scope: "POST /api/projects",
          key: input.key,
          request: input.request,
          status: 201,
        },
        async (tx) => {
          await tx.workspace.upsert({
            where: { id: WORKSPACE_ID },
            create: { id: WORKSPACE_ID },
            update: {},
          });
          const row = await tx.project.create({
            data: {
              workspaceId: WORKSPACE_ID,
              name: input.request.name,
              idea: input.request.idea,
              purpose: input.request.purpose ?? null,
              constraints: input.request.constraints ?? null,
              ceoLevel: input.request.ceoLevel,
            },
            include: projectInclude,
          });
          return toProject(row);
        },
      );
    },

    async list(query) {
      const rows = await db.project.findMany({
        where: {
          workspaceId: WORKSPACE_ID,
          archivedAt: query.archived ? { not: null } : null,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: projectInclude,
      });
      const items = rows.slice(0, query.limit);
      return {
        items: items.map(toProjectSummary),
        nextCursor:
          rows.length > query.limit ? items[items.length - 1].id : null,
      };
    },

    async find(id) {
      const row = await db.project.findFirst({
        where: { id, workspaceId: WORKSPACE_ID },
        include: projectInclude,
      });
      return row ? toProject(row) : null;
    },

    async setArchived(id, archived) {
      await db.project.updateMany({
        where: { id, workspaceId: WORKSPACE_ID },
        data: { archivedAt: archived ? new Date() : null },
      });
    },
  };
}
