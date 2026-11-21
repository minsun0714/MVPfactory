import type { RunLimits, Usage } from "@/contracts/runs";

/** 한도 항목의 이름(사용자에게 보여 줄 수 있는 문장에 쓴다) */
const LABELS: Record<keyof RunLimits, string> = {
  maxModelCalls: "모델 호출 횟수",
  maxFixAttempts: "자동 수정 횟수",
  maxActiveSeconds: "작업 시간",
  maxEstimatedCost: "예상 비용",
};

/**
 * 사용량이 한도에 이르렀는지 판단한다. 도달한 첫 항목의 이름을 돌려주고, 여유가 있으면 null이다.
 * - 설정의 `null`은 기본값 상속이다. 저장 계층에서 환경변수/코드 기본값을 확정한 뒤 전달한다. 과거 Run의 null은 별도로 보존한다.
 * - 한도 `0`은 "허용하지 않음"이다. 사용량이 0이어도 도달한 것으로 본다.
 * - 대기 시간(CEO 응답을 기다린 시간)은 작업 시간에 포함하지 않는다.
 */
export function reachedLimit(limits: RunLimits, usage: Usage): string | null {
  const checks: [keyof RunLimits, number | null, number][] = [
    ["maxModelCalls", limits.maxModelCalls, usage.modelCalls],
    ["maxFixAttempts", limits.maxFixAttempts, usage.fixAttempts],
    ["maxActiveSeconds", limits.maxActiveSeconds, usage.activeSeconds],
    [
      "maxEstimatedCost",
      limits.maxEstimatedCost,
      usage.estimatedCost?.amount ?? 0,
    ],
  ];
  for (const [key, max, used] of checks)
    if (max !== null && used >= max) return LABELS[key];
  return null;
}

export const EMPTY_USAGE: Usage = {
  modelCalls: 0,
  fixAttempts: 0,
  activeSeconds: 0,
  waitingSeconds: 0,
  estimatedCost: null,
};
