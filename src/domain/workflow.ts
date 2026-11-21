/**
 * 실행 흐름의 순수 규칙. WORKFLOW.md §5, §6을 따른다.
 * 저장·LangGraph·모델 호출을 모르며, 어떤 검토가 언제 필요한지만 판단한다.
 */
import type { CeoLevel, RoleId } from "@/contracts/common";
import type { DecisionKind } from "@/contracts/decisions";

export type StepDef = { nodeId: string; label: string; role: RoleId | null };

/** 단계 정의. `nodeId`는 WORKFLOW.md의 노드 번호다. */
export const STEPS = {
  intake: { nodeId: "W02", label: "범위 확인", role: "PM" },
  plan: { nodeId: "W03", label: "기획", role: "PLANNER" },
  design: { nodeId: "W05", label: "화면 설계", role: "DESIGNER" },
  freeze: { nodeId: "W07", label: "요구사항 확정", role: null },
  implement: { nodeId: "W08", label: "개발 계획", role: "DEVELOPER" },
  finalize: { nodeId: "W19", label: "마무리", role: null },
} as const satisfies Record<string, StepDef>;

/** 역할이 산출물 하나를 만드는 단계 */
export type RoleStepKey = "intake" | "plan" | "design" | "implement";

export type ReviewKind = Exclude<DecisionKind, "EXCEPTION">;

/** 검토 지점 하나의 정의 */
export type ReviewDef = {
  kind: ReviewKind;
  nodeId: string;
  label: string;
  /** 검토 제안을 함께 논의하는 역할 */
  participants: RoleId[];
  /** 수정 요청을 받으면 다시 만드는 단계 */
  revise: RoleStepKey[];
};

export const REVIEWS: Record<ReviewKind, ReviewDef> = {
  SCOPE_REVIEW: {
    kind: "SCOPE_REVIEW",
    nodeId: "W04",
    label: "기능 범위 검토",
    participants: ["PM", "PLANNER", "DESIGNER", "DEVELOPER"],
    revise: ["plan"],
  },
  DESIGN_REVIEW: {
    kind: "DESIGN_REVIEW",
    nodeId: "W06",
    label: "화면 방향 검토",
    participants: ["PM", "PLANNER", "DESIGNER", "DEVELOPER"],
    revise: ["design"],
  },
  INTEGRATED_REVIEW: {
    kind: "INTEGRATED_REVIEW",
    nodeId: "W06",
    label: "기능·화면 통합안 검토",
    participants: ["PM", "PLANNER", "DESIGNER", "DEVELOPER"],
    revise: ["plan", "design"],
  },
};

/**
 * CEO 개입 수준별 예정된 검토. 위임형 0개, 핵심 결정형 1개(구현 전), 공동 설계형 2개(기능 → 화면).
 * 위임형은 CEO가 답한 것처럼 결정을 만들지 않는다.
 */
export function reviewsAfter(
  ceoLevel: CeoLevel,
  point: "plan" | "design",
): ReviewKind | null {
  if (point === "plan")
    return ceoLevel === "COLLABORATIVE" ? "SCOPE_REVIEW" : null;
  if (ceoLevel === "COLLABORATIVE") return "DESIGN_REVIEW";
  if (ceoLevel === "KEY_DECISIONS") return "INTEGRATED_REVIEW";
  return null;
}

export function reviewCountOf(ceoLevel: CeoLevel): number {
  return (["plan", "design"] as const).filter((point) =>
    reviewsAfter(ceoLevel, point),
  ).length;
}
