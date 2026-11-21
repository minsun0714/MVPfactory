import type { BlockedReason, RunStatus, RunType } from "@/contracts/runs";
import { AppError } from "@/domain/errors";

export type RunStartState = {
  type: RunType;
  archived: boolean;
  totalRuns: number;
  succeededRuns: number;
};

/**
 * 새 Run을 시작할 수 있는지 판단한다.
 * - 보관된 프로젝트에서는 시작할 수 없다.
 * - 최초 생성(INITIAL)은 아직 Run이 없을 때만 가능하다. 실패한 Run은 retry로 이어간다.
 * - 수정(REVISION)은 완료된 Run이 하나 이상 있어야 한다.
 */
export function assertCanStartRun(state: RunStartState): void {
  if (state.archived)
    throw new AppError(
      "INVALID_RUN_STATE",
      "보관된 프로젝트에서는 실행을 시작할 수 없습니다.",
    );
  if (state.type === "INITIAL" && state.totalRuns > 0)
    throw new AppError(
      "INVALID_RUN_STATE",
      "이미 실행이 있는 프로젝트입니다. 실패한 실행은 다시 시도하고, 완료된 뒤에는 수정으로 시작하세요.",
    );
  if (state.type === "REVISION" && state.succeededRuns === 0)
    throw new AppError(
      "INVALID_RUN_STATE",
      "완료된 실행이 있어야 수정을 시작할 수 있습니다.",
    );
}

const TERMINAL: readonly RunStatus[] = ["FAILED", "SUCCEEDED"];

export type PauseDecision =
  | "already" // 이미 정지했거나 정지 요청이 반영됨
  | "pause-now" // 진행 중인 작업이 없어 바로 정지
  | "request"; // 진행 중이라 안전한 지점에서 정지하도록 요청

/**
 * 일시정지 요청을 어떻게 처리할지 판단한다.
 * 진행 중(RUNNING)이면 즉시 정지하지 않고 요청만 저장한다. 이미 전송된 외부 요청을 취소했다고 표시하지 않기 위해서다.
 */
export function decidePause(run: {
  status: RunStatus;
  pauseRequested: boolean;
}): PauseDecision {
  if (TERMINAL.includes(run.status))
    throw new AppError(
      "INVALID_RUN_STATE",
      "이미 끝난 실행은 일시정지할 수 없습니다.",
    );
  if (run.status === "PAUSED" || run.pauseRequested) return "already";
  if (run.status === "RUNNING") return "request";
  return "pause-now";
}

export type ResumeDecision =
  | "already" // 정지 중이 아니어서 할 일이 없음
  | "cancel-request" // 정지 요청만 있었고 아직 정지 전이라 요청을 취소
  | "to-blocked" // 해소되지 않은 차단 사유가 남아 있음
  | "to-waiting" // 아직 응답 없는 CEO 질문이 있음
  | "to-queued"; // 실행 조건이 충족되어 대기열로

/** 재개 시 돌아갈 상태를 판단한다. 차단 사유는 정지했다 재개해도 자동으로 해소되지 않는다. */
export function decideResume(run: {
  status: RunStatus;
  pauseRequested: boolean;
  blockedReason: BlockedReason | null;
  hasOpenDecision: boolean;
}): ResumeDecision {
  if (TERMINAL.includes(run.status))
    throw new AppError(
      "INVALID_RUN_STATE",
      "이미 끝난 실행은 재개할 수 없습니다.",
    );
  if (run.status !== "PAUSED")
    return run.pauseRequested ? "cancel-request" : "already";
  if (run.blockedReason) return "to-blocked";
  if (run.hasOpenDecision) return "to-waiting";
  return "to-queued";
}

/**
 * 실패한 Run을 다시 시도할 수 있는지 판단한다.
 * 이미 재시도되어 대기열에 있으면 `already`(멱등), 더 최신 목표가 접수되었으면 거절한다.
 */
export function decideRetry(run: {
  status: RunStatus;
  projectGeneration: number;
  latestProjectGeneration: number;
}): "retry" | "already" {
  if (run.status === "QUEUED" || run.status === "RUNNING") return "already";
  if (run.status !== "FAILED")
    throw new AppError(
      "INVALID_RUN_STATE",
      "실패한 실행만 다시 시도할 수 있습니다.",
    );
  if (run.projectGeneration < run.latestProjectGeneration)
    throw new AppError(
      "STALE_GENERATION",
      "더 최신 목표가 접수되어 이 실행은 다시 시도할 수 없습니다. 최신 결과를 기준으로 새 수정을 시작하세요.",
    );
  return "retry";
}
