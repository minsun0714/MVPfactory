import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "@/domain/errors";

const TTL_MS = 24 * 60 * 60 * 1000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRequest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function isUniqueViolation(error: unknown, model?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  )
    return false;
  return (
    model === undefined ||
    (error.meta as { modelName?: string } | undefined)?.modelName === model
  );
}

/**
 * 같은 `scope`+`key`의 요청은 처음 응답을 그대로 돌려준다. 키는 같은데 본문이 다르면 거절한다.
 * 같은 키의 요청이 동시에 오면 하나만 저장되고 나머지는 저장된 응답을 돌려준다.
 */
export async function runIdempotent<T>(
  db: PrismaClient,
  options: { scope: string; key: string; request: unknown; status: number },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const requestHash = hashRequest(options.request);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope: options.scope, key: options.key } },
        });
        if (existing && existing.expiresAt > new Date()) {
          if (existing.requestHash !== requestHash)
            throw new AppError(
              "IDEMPOTENCY_KEY_REUSED",
              "같은 Idempotency-Key로 다른 내용의 요청을 보낼 수 없습니다.",
            );
          return existing.responseBody as T;
        }
        if (existing)
          await tx.idempotencyRecord.delete({ where: { id: existing.id } });
        const result = await work(tx);
        await tx.idempotencyRecord.create({
          data: {
            scope: options.scope,
            key: options.key,
            requestHash,
            responseStatus: options.status,
            responseBody: result as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        });
        return result;
      });
    } catch (error) {
      // 같은 키의 동시 요청이 먼저 저장됐다면 유니크 제약이 어느 테이블에서 걸렸든(멱등 기록, 실행 예약 등)
      // 한 번 다시 읽어 저장된 응답을 돌려준다. 키가 달라 진짜 충돌이면 두 번째 시도에서도 같은 오류가 난다.
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}
