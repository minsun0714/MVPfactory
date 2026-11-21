import type { PrismaClient } from "@prisma/client";
import type { HealthRepository } from "@/application/ports";

/** 이 시간 안에 heartbeat가 있으면 워커가 살아 있는 것으로 본다. */
const WORKER_FRESH_MS = 30_000;

export function createHealthRepository(
  db: PrismaClient,
  now: () => Date = () => new Date(),
): HealthRepository {
  return {
    async check() {
      const checkedAt = now();
      let database: "OK" | "DOWN" = "OK";
      let worker: "OK" | "DOWN" | "UNKNOWN" = "UNKNOWN";
      try {
        await db.$queryRaw`SELECT 1`;
        const latest = await db.workerHeartbeat.findFirst({
          orderBy: { lastSeenAt: "desc" },
        });
        if (latest)
          worker =
            checkedAt.getTime() - latest.lastSeenAt.getTime() <= WORKER_FRESH_MS
              ? "OK"
              : "DOWN";
      } catch {
        // 연결 정보나 오류 문구는 응답에 담지 않는다.
        database = "DOWN";
      }
      return {
        web: "OK",
        database,
        worker,
        checkedAt: checkedAt.toISOString(),
      };
    },
  };
}
