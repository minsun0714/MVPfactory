import type {
  DecisionChoice,
  DecisionKind,
  DecisionResponseRequest,
  DecisionStatus,
} from "@/contracts/decisions";
import type { RunStatus } from "@/contracts/runs";
import { AppError } from "@/domain/errors";

export type DecisionState = {
  kind: DecisionKind;
  status: DecisionStatus;
  proposalVersion: number;
  optionIds: string[];
  response: {
    choice: DecisionChoice;
    optionId: string | null;
    comment: string | null;
  } | null;
};

export type RunControlState = { status: RunStatus; pauseRequested: boolean };

export type ResponseVerdict = "accept" | "replay";

function sameResponse(
  state: DecisionState,
  request: DecisionResponseRequest,
): boolean {
  const saved = state.response;
  return (
    saved !== null &&
    request.proposalVersion === state.proposalVersion &&
    saved.choice === request.choice &&
    saved.optionId === (request.optionId ?? null) &&
    saved.comment === (request.comment ?? null)
  );
}

function assertChoiceFitsKind(
  state: DecisionState,
  request: DecisionResponseRequest,
): void {
  const fail = (field: string, message: string) =>
    new AppError("VALIDATION_FAILED", message, {
      details: { fields: [{ field, message }] },
    });
  if (state.kind === "EXCEPTION") {
    if (request.choice !== "SELECT_OPTION")
      throw fail("choice", "예외 결정은 선택지를 골라 응답해야 합니다.");
    if (!request.optionId || !state.optionIds.includes(request.optionId))
      throw fail("optionId", "제안에 없는 선택지입니다.");
  } else if (request.choice === "SELECT_OPTION") {
    throw fail(
      "choice",
      "이 검토에는 승인 또는 수정 요청으로 응답해야 합니다.",
    );
  }
}

/**
 * CEO 응답을 받아도 되는지 판단한다. 순수 함수이며 저장은 하지 않는다.
 * - `replay`: 같은 응답의 재전송. 같은 결과를 돌려주고 다시 적용하지 않는다.
 * - `accept`: 처음 받는 유효한 응답.
 * 응답이 없다고 승인으로 보지 않으며, 시간 경과를 판단에 쓰지 않는다.
 */
export function evaluateDecisionResponse(
  decision: DecisionState,
  run: RunControlState,
  request: DecisionResponseRequest,
): ResponseVerdict {
  if (decision.status === "ANSWERED" || decision.status === "APPLIED") {
    if (sameResponse(decision, request)) return "replay";
    throw new AppError(
      "DECISION_ALREADY_ANSWERED",
      "이미 다른 응답이 저장된 결정입니다.",
    );
  }
  if (decision.status !== "OPEN")
    throw new AppError(
      "DECISION_NOT_OPEN",
      "지금은 응답할 수 없는 결정입니다.",
    );
  if (request.proposalVersion !== decision.proposalVersion)
    throw new AppError(
      "PROPOSAL_VERSION_MISMATCH",
      "제안이 새 버전으로 바뀌었습니다. 최신 제안을 확인하세요.",
      { details: { latestVersion: decision.proposalVersion } },
    );
  assertChoiceFitsKind(decision, request);
  if (run.pauseRequested || run.status === "PAUSED")
    throw new AppError(
      "RUN_PAUSED",
      "일시정지된 실행에는 응답할 수 없습니다. 재개한 뒤 응답하세요.",
    );
  if (run.status !== "WAITING_CEO")
    throw new AppError(
      "DECISION_NOT_OPEN",
      "지금은 응답할 수 없는 결정입니다.",
    );
  return "accept";
}
