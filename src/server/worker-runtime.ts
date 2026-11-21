/**
 * 워커의 구성. 구체 구현을 만들어 연결한다(Composition Root).
 * 진입점(`src/worker.ts`)과 테스트가 같은 구성을 쓴다.
 */
import { randomUUID } from "node:crypto";
import { createWorkflowSteps } from "@/application/workflow-steps";
import { createWorker } from "@/application/worker";
import { createGraphEngine } from "@/infrastructure/workflow/graph-engine";
import { createWorkflowStore } from "@/infrastructure/prisma/workflow-store";
import { db } from "@/lib/db";

export const WORKER_VERSION = "demo-0.1";

export type WorkerRuntimeOptions = {
  connectionString: string;
  /** 데모 진행을 화면에서 따라갈 수 있도록 단계 사이에 두는 지연(ms) */
  demoDelayMs: number;
  workerId?: string;
  log?: (message: string) => void;
  /** 로그와 실패 사유에서 비밀값을 가리는 함수 */
  redact?: (text: string) => string;
};

export async function createWorkerRuntime(options: WorkerRuntimeOptions) {
  const store = createWorkflowStore(db);
  const steps = createWorkflowSteps(store, {
    demoDelayMs: options.demoDelayMs,
  });
  const engine = await createGraphEngine({
    connectionString: options.connectionString,
    steps,
    store,
  });
  const worker = createWorker({
    store,
    engine,
    workerId: options.workerId ?? `worker-${randomUUID().slice(0, 8)}`,
    log: options.log,
    redact: options.redact,
  });
  return {
    worker,
    /** 처리할 Job이 없어질 때까지 반복한다. 테스트와 일괄 처리에 쓴다. */
    async drain(limit = 50): Promise<number> {
      let processed = 0;
      while (processed < limit && (await worker.runOnce())) processed += 1;
      return processed;
    },
    close: () => engine.close(),
  };
}

export type WorkerRuntime = Awaited<ReturnType<typeof createWorkerRuntime>>;
