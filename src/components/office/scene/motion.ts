import type { RoleId } from "@/contracts";
import { actors } from "@/components/office/scene/model";
import type { Point } from "@/components/office/scene/model";

export type Facing = "front-left" | "front-right" | "back-left" | "back-right";
export type MotionPhase = "prepare" | "walk" | "settle" | "seated";
export const WALK_SPEED = 150;
export const PREPARE_MS = 240;
export const SETTLE_MS = 240;
/** Keep possession while walking back; release only when setting it down at the desk. */
export function carriesLaptop(
  delivering: boolean,
  carried: boolean,
  pose: { phase: MotionPhase; lift: number } | null,
  returningToDesk = true,
): boolean {
  if (!pose) return delivering || (carried && !returningToDesk);
  if (delivering) return pose.phase !== "prepare" || pose.lift >= 0.65;
  return (
    carried && !(returningToDesk && pose.phase === "settle" && pose.lift < 0.4)
  );
}
const roles = Object.keys(actors) as RoleId[];
// Authored aisles keep feet outside the table footprint. Reverse the same route home.
const aisles: Record<RoleId, Point[]> = {
  PM: [
    { x: 579, y: 392 },
    { x: 640, y: 425 },
    { x: 686, y: 465 },
  ],
  PLANNER: [
    { x: 482, y: 437 },
    { x: 581, y: 495 },
    { x: 589, y: 601 },
    { x: 637, y: 645 },
  ],
  DESIGNER: [
    { x: 809, y: 410 },
    { x: 866, y: 458 },
  ],
  DEVELOPER: [
    { x: 1021, y: 482 },
    { x: 976, y: 555 },
    { x: 949, y: 615 },
    { x: 906, y: 641 },
  ],
};
export const distance = (a: Point, b: Point) =>
  Math.hypot(b.x - a.x, b.y - a.y);
export function pathLength(path: Point[]) {
  return path.slice(1).reduce((sum, p, i) => sum + distance(path[i], p), 0);
}
export function routeFor(
  role: RoleId,
  from: Point,
  meeting: boolean,
  destination?: Point,
): Point[] {
  const a = actors[role];
  const home = { x: a.x, y: a.y };
  const seat = destination ?? { x: a.seatX, y: a.seatY };
  const route = [home, ...aisles[role], seat];
  if (!meeting) route.reverse();
  // Interrupted journeys resume via the nearest remaining waypoint, not the old origin.
  let nearest = 0;
  let best = Infinity;
  route.forEach((p, i) => {
    if (distance(from, p) < best) {
      best = distance(from, p);
      nearest = i;
    }
  });
  return [from, ...route.slice(Math.min(nearest + 1, route.length - 1))];
}
export function samplePath(path: Point[], travelled: number) {
  let remaining = Math.max(0, travelled);
  for (let i = 1; i < path.length; i++) {
    const length = distance(path[i - 1], path[i]);
    if (remaining <= length || i === path.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 1;
      return {
        point: {
          x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
          y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
        },
        facing: facingFor(path[i - 1], path[i]),
      };
    }
    remaining -= length;
  }
  return { point: path[0], facing: "front-right" as Facing };
}
export function facingFor(from: Point, to: Point): Facing {
  return `${to.y < from.y ? "back" : "front"}-${to.x < from.x ? "left" : "right"}`;
}
export function seatFacing(role: RoleId): Facing {
  return role === "PM"
    ? "front-right"
    : role === "DESIGNER"
      ? "front-left"
      : role === "PLANNER"
        ? "back-right"
        : "back-left";
}
export function deskFacing(role: RoleId): Facing {
  return role === "PM" || role === "PLANNER" ? "back-left" : "back-right";
}
export type Journey = {
  path: Point[];
  elapsed: number;
  delay: number;
  length: number;
  meeting: boolean;
};
export function createJourney(
  role: RoleId,
  from: Point,
  meeting: boolean,
  destination?: Point,
): Journey {
  const path = routeFor(role, from, meeting, destination);
  return {
    path,
    elapsed: 0,
    delay: roles.indexOf(role) * 100,
    length: pathLength(path),
    meeting,
  };
}
export function sampleJourney(journey: Journey) {
  const time = journey.elapsed - journey.delay;
  const walkMs = (journey.length / WALK_SPEED) * 1000;
  const phase: MotionPhase =
    time < PREPARE_MS
      ? "prepare"
      : time < PREPARE_MS + walkMs
        ? "walk"
        : time < PREPARE_MS + walkMs + SETTLE_MS
          ? "settle"
          : "seated";
  const sample = samplePath(
    journey.path,
    ((time - PREPARE_MS) / 1000) * WALK_SPEED,
  );
  const lift =
    phase === "prepare"
      ? Math.max(0, Math.min(1, time / PREPARE_MS))
      : phase === "walk"
        ? 1
        : phase === "settle"
          ? 1 - (time - PREPARE_MS - walkMs) / SETTLE_MS
          : 0;
  return {
    ...sample,
    phase,
    lift,
    waiting: time < 0,
    step: Math.floor(Math.max(0, time - PREPARE_MS) / 130) % 4,
  };
}
// Depth changes continuously with feet, including the table's front edge.
export function walkingDepth(point: Point) {
  return point.y < 550 ? 29 + ((point.y - 400) / 150) * 2 : 33;
}
export function statementDuration(text: string) {
  return Math.min(5200, Math.max(2200, text.length * 65));
}
