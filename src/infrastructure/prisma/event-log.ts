import type { Prisma } from "@prisma/client";
import type { RoleId, RunEventDataMap, RunEventType } from "@/contracts";

export const RUN_EVENT_CHANNEL = "run_events";

export type NewRunEvent<T extends RunEventType = RunEventType> = {
  type: T;
  data: RunEventDataMap[T];
  summary: string;
  stageId?: string | null;
  role?: RoleId | null;
  refs?: { artifactId?: string; decisionId?: string; meetingId?: string };
};

/**
 * 이벤트를 추가한다. 호출하는 트랜잭션 안에서 실행해야 한다.
 * `Run.lastSequence`를 먼저 올려 순번을 받고(행 잠금으로 순번이 겹치지 않는다) 같은 트랜잭션에서
 * 이벤트를 저장한다. 알림은 트랜잭션이 커밋될 때 전달된다.
 */
export async function appendRunEvent<T extends RunEventType>(
  tx: Prisma.TransactionClient,
  runId: string,
  event: NewRunEvent<T>,
): Promise<number> {
  const run = await tx.run.update({
    where: { id: runId },
    data: { lastSequence: { increment: 1 } },
    select: { lastSequence: true },
  });
  await tx.runEvent.create({
    data: {
      runId,
      sequence: run.lastSequence,
      type: event.type,
      occurredAt: new Date(),
      stageId: event.stageId ?? null,
      role: event.role ?? null,
      summary: event.summary,
      refs: event.refs ?? {},
      data: event.data as Prisma.InputJsonValue,
    },
  });
  await tx.$executeRaw`SELECT pg_notify(${RUN_EVENT_CHANNEL}, ${runId})`;
  return run.lastSequence;
}
