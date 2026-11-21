import type { PrismaClient } from "@prisma/client";
import type { ResultRepository } from "@/application/ports";
import { buildResult } from "@/domain/results";
import { WORKSPACE_ID } from "@/lib/db";

export function createResultRepository(db: PrismaClient): ResultRepository {
  return {
    async result(projectId) {
      const project = await db.project.findFirst({
        where: { id: projectId, workspaceId: WORKSPACE_ID },
        include: { lastGoodDeployment: true },
      });
      if (!project) return null;
      const workspace = await db.workspace.findUnique({
        where: { id: WORKSPACE_ID },
      });

      const latestRun = await db.run.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, mode: true },
      });
      const [report, published, repository, database] = await Promise.all([
        latestRun
          ? db.verificationReport.findFirst({
              where: { runId: latestRun.id },
              orderBy: { createdAt: "desc" },
              include: { items: true },
            })
          : null,
        db.deployment.findFirst({
          where: { projectId, stage: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
        }),
        db.externalResource.findFirst({
          where: { projectId, kind: "REPOSITORY" },
        }),
        db.externalResource.findFirst({
          where: { projectId, kind: "DATABASE" },
        }),
      ]);
      const databaseOperation = database
        ? await db.externalOperation.findFirst({
            where: {
              projectId,
              provider: database.provider,
              status: "SUCCEEDED",
              externalId: database.externalId,
            },
          })
        : null;

      const visibility =
        (repository?.meta as { visibility?: string } | null)?.visibility ===
        "PUBLIC"
          ? "PUBLIC"
          : (workspace?.repoVisibility ?? "PRIVATE");

      return buildResult({
        latestRun,
        items: (report?.items ?? []).map((item) => ({
          id: item.checkId,
          description: item.description,
          result: item.result,
        })),
        publishedDeployment: published
          ? {
              id: published.providerDeploymentId,
              url: published.url,
              commitSha: published.commitSha,
            }
          : null,
        repository: repository ? { url: repository.url, visibility } : null,
        databaseResource: database
          ? { hasSucceededOperation: databaseOperation !== null }
          : null,
        lastGood: project.lastGoodDeployment
          ? {
              commitSha: project.lastGoodDeployment.commitSha,
              deploymentId: project.lastGoodDeployment.providerDeploymentId,
              at: project.lastGoodDeployment.createdAt.toISOString(),
            }
          : null,
      });
    },

    async runExists(runId) {
      return (
        (await db.run.count({
          where: { id: runId, project: { workspaceId: WORKSPACE_ID } },
        })) > 0
      );
    },

    async verification(runId) {
      const report = await db.verificationReport.findFirst({
        where: { runId, run: { project: { workspaceId: WORKSPACE_ID } } },
        orderBy: { createdAt: "desc" },
        include: { items: { orderBy: { checkId: "asc" } } },
      });
      if (!report) return null;
      return {
        runId,
        target: {
          specVersion: report.specVersion,
          commitSha: report.commitSha,
          deploymentId: report.deploymentId,
        },
        items: report.items.map((item) => ({
          id: item.checkId,
          description: item.description,
          result: item.result,
          evidence: item.evidence,
          reason: item.reason,
        })),
      };
    },
  };
}
