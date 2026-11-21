/**
 * 워커가 Job 하나를 처리하는 방법. 그래프 엔진(`WorkflowEngine`)과 저장 계약만 사용한다.
 * - Job은 "이 Run을 이어서 진행하라"는 명령이다. 처리가 끝나도 Run이 끝난 것은 아니다(CEO 대기 등).
 * - 같은 Job을 두 번 받거나 이미 진행할 수 없는 Run이면 아무 일도 하지 않고 이유를 남긴다.
 */
import type { ClaimedJob, WorkflowStore } from "@/application/workflow-ports";

export type AdvanceResult = "waiting" | "paused" | "finished";

export interface WorkflowEngine {
  /** 저장된 체크포인트에서 이어서 진행한다. CEO 응답이 필요하거나 정지·완료되면 돌아온다. */
  advance(runId: string): Promise<AdvanceResult>;
}

export type WorkerDeps = {
  store: WorkflowStore;
  engine: WorkflowEngine;
  workerId: string;
  now?: () => number;
  log?: (message: string) => void;
  /** 로그와 실패 사유에 남기기 전에 비밀값을 가린다. 지정하지 않으면 그대로 둔다. */
  redact?: (text: string) => string;
};

function sanitize(error: unknown, redact: (text: string) => string): string {
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  return redact(message).slice(0, 300);
}

export function createWorker(deps: WorkerDeps) {
  const { store, engine, workerId } = deps;
  const now = deps.now ?? Date.now;
  const redact = deps.redact ?? ((text: string) => text);
  const log = (message: string) => deps.log?.(redact(message));

  async function process(job: ClaimedJob): Promise<void> {
    const startedAt = now();
    const run = await store.loadRun(job.runId);
    if (!run) {
      await store.finishJob(job, {
        status: "DONE",
        noOpReason: "실행을 찾을 수 없어 건너뜀",
      });
      return;
    }
    // 대기열에 있는 Run만 시작한다. 정지했거나 이미 끝난 Run의 오래된 Job은 건너뛴다.
    if (!(await store.startRun(job.runId))) {
      await store.finishJob(job, {
        status: "DONE",
        noOpReason: `실행이 대기 상태가 아니어서 건너뜀(${run.status})`,
      });
      return;
    }
    try {
      const result = await engine.advance(job.runId);
      log(`실행 ${job.runId}: ${result}`);
      await store.finishJob(job, { status: "DONE" });
    } catch (error) {
      const message = sanitize(error, redact);
      log(`실행 ${job.runId} 실패: ${message}`);
      await store.failRun(job.runId, {
        stage: "워크플로우",
        message,
        retryable: true,
      });
      await store.finishJob(job, { status: "FAILED", error: message });
    } finally {
      // CEO 대기 시간은 제외한 실제 작업 시간만 기록한다.
      await store.addActiveSeconds(
        job.runId,
        Math.max(0, Math.round((now() - startedAt) / 1000)),
      );
    }
  }

  return {
    /** 대기 중인 Job 하나를 처리한다. 처리할 Job이 없으면 false */
    async runOnce(): Promise<boolean> {
      const job = await store.claimJob(workerId);
      if (!job) return false;
      await process(job);
      return true;
    },
    recoverInterrupted: () => store.recoverInterruptedJobs(),
    heartbeat: (version: string) => store.recordHeartbeat(workerId, version),
  };
}

export type Worker = ReturnType<typeof createWorker>;
