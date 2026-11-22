import type { RunStatus } from "@/contracts";
import { PixelIcon } from "@/components/ui/PixelIcon";

// DESIGN_SYSTEM §4.1: 상태는 색만이 아니라 아이콘·라벨을 함께 표시한다.
export const runTones = {
  QUEUED: "neutral",
  RUNNING: "info",
  WAITING_CEO: "warning",
  PAUSED: "neutral",
  BLOCKED: "danger",
  FAILED: "danger",
  SUCCEEDED: "success",
} as const satisfies Record<RunStatus, string>;

const runIcons = {
  QUEUED: "minus",
  RUNNING: "minus",
  WAITING_CEO: "alert",
  PAUSED: "minus",
  BLOCKED: "alert",
  FAILED: "close",
  SUCCEEDED: "check",
} as const satisfies Record<RunStatus, string>;

export function RunStatusBadge({
  status,
  label,
}: {
  status: RunStatus;
  label: string;
}) {
  return (
    <span className="run-status-badge" data-tone={runTones[status]}>
      {status === "RUNNING" ? (
        <span className="run-status-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <PixelIcon name={runIcons[status]} width="16" height="16" />
      )}
      {label}
    </span>
  );
}
