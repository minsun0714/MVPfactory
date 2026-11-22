import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppDatabaseStore } from "@/application/app-database";
import { parseDataPlan } from "@/domain/data-plan";

type Meta = {
  projectRef: string;
  schema: string;
  plan: unknown;
  version: number;
};

export function createAppDatabaseStore(db: PrismaClient): AppDatabaseStore {
  return {
    async current(projectId) {
      const resource = await db.externalResource.findUnique({
        where: {
          projectId_provider_kind: {
            projectId,
            provider: "supabase",
            kind: "DATABASE",
          },
        },
      });
      if (!resource) return null;
      const meta = resource.meta as Meta;
      return { plan: parseDataPlan(meta.plan), version: meta.version };
    },

    recordApplied(input) {
      return db.$transaction(async (tx) => {
        const meta = {
          projectRef: input.projectRef,
          schema: input.schema,
          plan: input.plan,
          version: input.migration.version,
        } as unknown as Prisma.InputJsonValue;
        const resource = await tx.externalResource.upsert({
          where: {
            projectId_provider_kind: {
              projectId: input.projectId,
              provider: "supabase",
              kind: "DATABASE",
            },
          },
          create: {
            projectId: input.projectId,
            provider: "supabase",
            kind: "DATABASE",
            externalId: `${input.projectRef}:${input.schema}`,
            url: `https://${input.projectRef}.supabase.co`,
            meta,
          },
          update: { meta },
        });
        const version = String(input.migration.version);
        const existing = await tx.appMigration.findUnique({
          where: {
            databaseResourceId_version: {
              databaseResourceId: resource.id,
              version,
            },
          },
        });
        if (existing) {
          // 같은 버전에 다른 내용이면 충돌이다(기록을 덮어쓰지 않는다).
          if (existing.checksum !== input.migration.checksum)
            throw new Error(
              `마이그레이션 버전 ${version}의 기록이 다른 내용과 충돌해요.`,
            );
          return;
        }
        await tx.appMigration.create({
          data: {
            databaseResourceId: resource.id,
            version,
            checksum: input.migration.checksum,
            status: "APPLIED",
            appliedAt: new Date(),
          },
        });
      });
    },
  };
}
