import type { Meeting, OfficeState, RoleId } from "@/contracts";
export const SCENE_SIZE = {
  width: 1300,
  height: 660,
  originX: 60,
  originY: 90,
};
export const actors = {
  PM: {
    asset: "pm",
    label: "PM",
    x: 551.72,
    y: 332.08,
    seatX: 686,
    seatY: 492,
    depth: 43,
    color: 0xf50079,
  },
  PLANNER: {
    asset: "planner",
    label: "기획자",
    x: 446.72,
    y: 377.08,
    seatX: 668,
    seatY: 621,
    depth: 46,
    color: 0xbd6428,
  },
  DESIGNER: {
    asset: "designer",
    label: "디자이너",
    x: 826.4,
    y: 351.25,
    seatX: 866,
    seatY: 490,
    depth: 21,
    color: 0x783cff,
  },
  DEVELOPER: {
    asset: "developer",
    label: "개발자",
    x: 971.6,
    y: 422.2,
    seatX: 876,
    seatY: 617,
    depth: 24,
    color: 0x009f77,
  },
} as const;
export type Point = { x: number; y: number };
export type SceneSnapshot = {
  projectId: string | null;
  meetingId: string | null;
  participants: RoleId[];
  speaker: RoleId | null;
  speakerSequence: number;
  paused: boolean;
  targets: Record<RoleId, Point>;
};
/** Server snapshots are the authority. This projection never produces a command. */
export function projectScene(
  state?: OfficeState,
  meeting?: Meeting,
): SceneSnapshot {
  const active = state?.activeMeeting;
  const participants =
    active &&
    ["IN_PROGRESS", "WAITING_CEO", "FAILED", "INTERRUPTED"].includes(
      active.status,
    )
      ? active.participants
      : [];
  const matching = active && meeting?.id === active.id ? meeting : undefined;
  const statement = matching?.statements.reduce<
    Meeting["statements"][number] | undefined
  >(
    (latest, next) =>
      !latest || next.sequence > latest.sequence ? next : latest,
    undefined,
  );
  return {
    projectId: state?.project.id ?? null,
    meetingId: active?.id ?? null,
    participants,
    speaker: statement?.role ?? null,
    speakerSequence: statement?.sequence ?? 0,
    paused: state?.run?.status === "PAUSED" || active?.status === "INTERRUPTED",
    targets: Object.fromEntries(
      Object.entries(actors).map(([role, actor]) => [
        role,
        participants.includes(role as RoleId)
          ? { x: actor.seatX, y: actor.seatY }
          : { x: actor.x, y: actor.y },
      ]),
    ) as Record<RoleId, Point>,
  };
}
export function interpolatePoint(
  from: Point,
  to: Point,
  progress: number,
): Point {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
  };
}
