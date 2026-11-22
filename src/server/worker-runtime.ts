/**
 * 워커의 구성. 구체 구현을 만들어 연결한다(Composition Root).
 * 진입점(`src/worker.ts`)과 테스트가 같은 구성을 쓴다.
 */
import { loadImpeccableGuide } from "@/infrastructure/generation-guides/impeccable";
import { randomUUID } from "node:crypto";
import { createRoleAgents } from "@/application/agents";
import {
  createSourceDeveloper,
  type CodeWriter,
} from "@/application/code-writer";
import type { ReleaseDeps } from "@/application/release";
import { createReleaseStore } from "@/infrastructure/prisma/release-store";
import type { LanguageModel } from "@/application/llm";
import { createExternalOperationStore } from "@/infrastructure/prisma/external-operation-store";
import {
  createMeteredModel,
  type TokenPrice,
} from "@/application/metered-model";
import type { Sandbox } from "@/application/sandbox";
import type { SourceStorage } from "@/application/source-storage";
import { createWorkflowSteps } from "@/application/workflow-steps";
import { createVerificationStore } from "@/infrastructure/prisma/verification-store";
import { createWorker } from "@/application/worker";
import { createGraphEngine } from "@/infrastructure/workflow/graph-engine";
import { createWorkflowStore } from "@/infrastructure/prisma/workflow-store";
import { db } from "@/lib/db";

export const WORKER_VERSION = "demo-0.1";

export type WorkerRuntimeOptions = {
  connectionString: string;
  /** 데모 진행을 화면에서 따라갈 수 있도록 단계 사이에 두는 지연(ms) */
  demoDelayMs: number;
  /** 단계 사이 지연 함수. 테스트가 진행 중인 시점에 개입할 때 쓴다. */
  sleep?: (ms: number) => Promise<void>;
  workerId?: string;
  log?: (message: string) => void;
  /** 로그와 실패 사유에서 비밀값을 가리는 함수 */
  redact?: (text: string) => string;
  /** 실제 실행에 쓰는 구성. 없으면 REAL Run은 시작 단계에서 멈춘다. */
  real?: {
    model: LanguageModel;
    codeWriter: CodeWriter;
    price: TokenPrice | null;
    sandbox: Sandbox;
    storage: SourceStorage;
    /** 소스에 들어가면 안 되는 비밀값 */
    secrets: (string | undefined | null)[];
    /** GitHub 반영과 Vercel 배포. 없으면 마무리 단계에서 멈춘다. */
    release?: Pick<ReleaseDeps, "github" | "vercel" | "supabase">;
  };
};

export async function createWorkerRuntime(options: WorkerRuntimeOptions) {
  const store = createWorkflowStore(db);
  const { real } = options;
  // 실제 실행의 디자이너는 저장소에 고정한 디자인 지침을 반드시 쓴다. 읽지 못하면 워커를 시작하지 않는다.
  const designGuide = real ? await loadImpeccableGuide() : null;
  const steps = createWorkflowSteps(store, {
    demoDelayMs: options.demoDelayMs,
    sleep: options.sleep,
    real: real
      ? (runId) => ({
          // 모델 호출은 이 Run의 한도와 사용량에 기록된다.
          agents: createRoleAgents(
            createMeteredModel({
              model: real.model,
              store,
              runId,
              price: real.price,
            }),
            { designGuide },
          ),
          developer: createSourceDeveloper({
            writer: real.codeWriter,
            runId,
            store,
          }),
          verification: {
            sandbox: real.sandbox,
            store: createVerificationStore(db),
            redact: options.redact ?? ((text) => text),
            secrets: real.secrets,
          },
          storage: real.storage,
          release: real.release
            ? {
                ...real.release,
                ledger: createExternalOperationStore(db),
                releases: createReleaseStore(db),
                verification: createVerificationStore(db),
                secrets: real.secrets,
              }
            : undefined,
        })
      : undefined,
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
