import type { RoleId } from "@/contracts/common";
import type { RoleState, RoleStatus } from "@/contracts/office";
import type { RunStatus } from "@/contracts/runs";
import { ROLE_IDS } from "@/contracts/common";

export type RoleActivity = {
  type: "step.started" | "step.completed";
  summary: string;
};

/**
 * 역할별 상태를 서버가 기록한 단계 이벤트에서 계산한다. 화면의 애니메이션이나 타이머로 정하지 않는다.
 * - 단계를 시작한 뒤 완료 이벤트가 없으면, Run 상태에 따라 작업 중·대기·실패로 본다.
 * - 완료 이벤트가 마지막이면 완료, 이벤트가 없으면 대기(IDLE)다.
 */
export function deriveRoleStates(
  run: { status: RunStatus } | null,
  lastActivity: Partial<Record<RoleId, RoleActivity>>,
  latestArtifactId: Partial<Record<RoleId, string>>,
): RoleState[] {
  return ROLE_IDS.map((role) => {
    const activity = run ? lastActivity[role] : undefined;
    let status: RoleStatus = "IDLE";
    if (run && activity) {
      if (activity.type === "step.completed") status = "DONE";
      else if (run.status === "RUNNING") status = "WORKING";
      else if (run.status === "FAILED") status = "FAILED";
      else if (run.status === "SUCCEEDED") status = "DONE";
      else status = "WAITING";
    }
    return {
      role,
      status,
      currentTask: activity?.summary ?? null,
      latestArtifactId: latestArtifactId[role] ?? null,
    };
  });
}

/** 최근 소식으로 보여 줄 만한 이벤트인지. 내부 상태 전환은 제외한다. */
export function isNewsworthy(type: string): boolean {
  return ![
    "run.status_changed",
    "run.pause_requested",
    "run.accepted",
  ].includes(type);
}
