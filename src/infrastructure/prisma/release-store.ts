import type { PrismaClient } from "@prisma/client";
import type { ReleaseStore } from "@/application/release";
import { appendRunEvent } from "@/infrastructure/prisma/event-log";

export function createReleaseStore(db: PrismaClient): ReleaseStore {
  return {
    async recordRepository(projectId, repo) {
      // 공개 범위는 처음 만들 때의 값을 유지한다(나중에 설정이 바뀌어도 기존 저장소는 바꾸지 않는다).
      await db.externalResource.upsert({
        where: {
          projectId_provider_kind: {
            projectId,
            provider: "github",
            kind: "REPOSITORY",
          },
        },
        create: {
          projectId,
          provider: "github",
          kind: "REPOSITORY",
          externalId: repo.externalId,
          url: repo.url,
          meta: { visibility: repo.visibility },
        },
        update: {},
      });
    },

    async recordDeploymentProject(projectId, project) {
      await db.externalResource.upsert({
        where: {
          projectId_provider_kind: {
            projectId,
            provider: "vercel",
            kind: "DEPLOYMENT_PROJECT",
          },
        },
        create: {
          projectId,
          provider: "vercel",
          kind: "DEPLOYMENT_PROJECT",
          externalId: project.externalId,
          meta: { name: project.name },
        },
        update: {},
      });
    },

    recordDeployment(input) {
      return db.$transaction(async (tx) => {
        const existing = await tx.deployment.findUnique({
          where: {
            projectId_providerDeploymentId: {
              projectId: input.projectId,
              providerDeploymentId: input.providerDeploymentId,
            },
          },
        });
        if (existing) return existing.id; // 같은 배포를 다시 기록하지 않는다(재시도).
        if (input.published)
          await tx.deployment.updateMany({
            where: { projectId: input.projectId, stage: "PUBLISHED" },
            data: { stage: "SUPERSEDED" },
          });
        const row = await tx.deployment.create({
          data: {
            projectId: input.projectId,
            runId: input.runId,
            providerDeploymentId: input.providerDeploymentId,
            commitSha: input.commitSha,
            sourceDigest: input.sourceDigest,
            envRevision: "none",
            url: input.url,
            stage: input.published ? "PUBLISHED" : "FAILED",
          },
        });
        if (input.published)
          await tx.project.update({
            where: { id: input.projectId },
            data: { lastGoodDeploymentId: row.id },
          });
        await appendRunEvent(tx, input.runId, {
          type: "external_operation.observed",
          summary: input.published
            ? `배포했어요: ${input.url}`
            : "배포했지만 운영 주소를 확인하지 못했어요.",
          data: {
            provider: "vercel",
            operationKind: "CREATE_DEPLOYMENT",
            status: "SUCCEEDED",
            resourceId: input.providerDeploymentId,
          },
        });
        return row.id;
      });
    },
  };
}
