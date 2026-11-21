import { Prisma, type PrismaClient } from "@prisma/client";
import type { CompanyRepository } from "@/application/ports";
import type {
  CharacterAppearance,
  Company,
  OfficeLayout,
  RoleId,
} from "@/contracts";
import { defaultCompany } from "@/domain/company";
import { AppError } from "@/domain/errors";
import { WORKSPACE_ID } from "@/lib/db";

type Row = {
  version: number;
  characters: Prisma.JsonValue;
  office: Prisma.JsonValue;
  updatedAt: Date;
};

const toCompany = (row: Row): Company => ({
  version: row.version,
  characters: row.characters as Company["characters"],
  office: row.office as unknown as OfficeLayout,
  updatedAt: row.updatedAt.toISOString(),
});

/** 처음 접근할 때 기본 회사 설정을 만든다. 동시에 접근해도 하나만 만들어진다. */
async function ensureRow(tx: Prisma.TransactionClient): Promise<Row> {
  await tx.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID },
    update: {},
  });
  const defaults = defaultCompany();
  return tx.companyLayout.upsert({
    where: { workspaceId: WORKSPACE_ID },
    create: {
      workspaceId: WORKSPACE_ID,
      characters: defaults.characters as unknown as Prisma.InputJsonValue,
      office: defaults.office as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export function createCompanyRepository(db: PrismaClient): CompanyRepository {
  async function save(
    version: number,
    change: (current: Row) => {
      characters?: Prisma.InputJsonValue;
      office?: Prisma.InputJsonValue;
    },
  ): Promise<Company> {
    return db.$transaction(async (tx) => {
      const current = await ensureRow(tx);
      if (current.version !== version)
        throw new AppError(
          "VERSION_CONFLICT",
          "다른 곳에서 먼저 저장했습니다. 최신 설정을 확인하세요.",
          {
            details: { latest: toCompany(current) },
          },
        );
      // 버전을 조건으로 걸어 동시에 저장해도 하나만 반영한다.
      const updated = await tx.companyLayout.updateMany({
        where: { workspaceId: WORKSPACE_ID, version },
        data: { ...change(current), version: { increment: 1 } },
      });
      const latest = await tx.companyLayout.findUniqueOrThrow({
        where: { workspaceId: WORKSPACE_ID },
      });
      if (updated.count === 0)
        throw new AppError(
          "VERSION_CONFLICT",
          "다른 곳에서 먼저 저장했습니다. 최신 설정을 확인하세요.",
          {
            details: { latest: toCompany(latest) },
          },
        );
      return toCompany(latest);
    });
  }

  return {
    get: () => db.$transaction((tx) => ensureRow(tx)).then(toCompany),

    updateCharacter(
      role: RoleId,
      version: number,
      appearance: CharacterAppearance,
    ) {
      return save(version, (current) => ({
        characters: {
          ...(current.characters as Record<string, unknown>),
          [role]: appearance,
        } as Prisma.InputJsonValue,
      }));
    },

    updateOffice(version, layout) {
      return save(version, () => ({
        office: layout as unknown as Prisma.InputJsonValue,
      }));
    },
  };
}
