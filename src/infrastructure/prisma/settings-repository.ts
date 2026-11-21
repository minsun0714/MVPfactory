import { Prisma, type PrismaClient } from "@prisma/client";
import type { SettingsRepository } from "@/application/ports";
import type { Connection, Provider, Settings } from "@/contracts";
import { PROVIDERS } from "@/contracts";
import {
  credentialEnvName,
  hasCredential,
} from "@/infrastructure/integrations/credentials";
import { workspaceRunLimits } from "@/infrastructure/integrations/default-limits";
import { WORKSPACE_ID } from "@/lib/db";

/**
 * 한 번도 확인하지 않은 공급자의 상태. 비밀 키가 `.env`에 있어도 실제로 확인하기 전에는
 * CONNECTED로 표시하지 않는다.
 */
function unverified(provider: Provider): Connection {
  return {
    provider,
    status: "NOT_CONNECTED",
    target: null,
    checkedAt: null,
    message: hasCredential(provider)
      ? "아직 연결을 확인하지 않았습니다. '연결 확인'을 실행하세요."
      : `.env에 ${credentialEnvName(provider)}를 설정한 뒤 연결을 확인하세요.`,
  };
}

export function createSettingsRepository(db: PrismaClient): SettingsRepository {
  async function read(): Promise<Settings> {
    const workspace = await db.workspace.upsert({
      where: { id: WORKSPACE_ID },
      create: { id: WORKSPACE_ID },
      update: {},
      include: { connections: true },
    });
    const connections = PROVIDERS.map((provider): Connection => {
      const row = workspace.connections.find(
        (connection) => connection.provider === provider,
      );
      return row
        ? {
            provider,
            status: row.status,
            target: row.target,
            checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
            message: row.message,
          }
        : unverified(provider);
    });
    return {
      connections,
      repoVisibility: workspace.repoVisibility,
      limits: workspaceRunLimits(workspace),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }

  return {
    get: read,

    async update(input) {
      const data: Prisma.WorkspaceUpdateInput = {};
      if (input.repoVisibility) data.repoVisibility = input.repoVisibility;
      const limits = input.limits;
      if (limits) {
        if ("maxModelCalls" in limits)
          data.limitMaxModelCalls = limits.maxModelCalls;
        if ("maxFixAttempts" in limits)
          data.limitMaxFixAttempts = limits.maxFixAttempts;
        if ("maxActiveSeconds" in limits)
          data.limitMaxActiveSeconds = limits.maxActiveSeconds;
        if ("maxEstimatedCost" in limits)
          data.limitMaxEstimatedCost = limits.maxEstimatedCost;
      }
      await db.workspace.upsert({
        where: { id: WORKSPACE_ID },
        create: { id: WORKSPACE_ID },
        update: {},
      });
      await db.workspace.update({ where: { id: WORKSPACE_ID }, data });
      return read();
    },

    async saveConnection(connection) {
      await db.workspace.upsert({
        where: { id: WORKSPACE_ID },
        create: { id: WORKSPACE_ID },
        update: {},
      });
      const data = {
        status: connection.status,
        target: connection.target,
        checkedAt: connection.checkedAt ? new Date(connection.checkedAt) : null,
        message: connection.message,
      };
      await db.connectionState.upsert({
        where: {
          workspaceId_provider: {
            workspaceId: WORKSPACE_ID,
            provider: connection.provider,
          },
        },
        create: {
          workspaceId: WORKSPACE_ID,
          provider: connection.provider,
          ...data,
        },
        update: data,
      });
      return connection;
    },
  };
}
