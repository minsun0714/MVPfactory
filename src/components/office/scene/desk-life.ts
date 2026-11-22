import { Graphics } from "pixi.js";
import type { RoleId } from "@/contracts";
import { actors, SCENE_SIZE } from "@/components/office/scene/model";

export type DeskActivity = { frame: number; active: boolean };
const timing: Record<
  RoleId,
  { offset: number; cycle: number; duration: number }
> = {
  PM: { offset: 700, cycle: 8400, duration: 4200 },
  PLANNER: { offset: 2200, cycle: 7100, duration: 4400 },
  DESIGNER: { offset: 400, cycle: 9600, duration: 7200 },
  DEVELOPER: { offset: 1400, cycle: 6300, duration: 3900 },
};
/** Cosmetic desk life only: never represents AI progress or market data. */
export function deskActivity(
  role: RoleId,
  clock: number,
  reduced: boolean,
): DeskActivity {
  if (reduced) return { frame: 0, active: false };
  const t = timing[role];
  const elapsed = (clock + t.offset) % t.cycle;
  return { frame: Math.floor(elapsed / 240) % 8, active: elapsed < t.duration };
}
const screens: Record<
  RoleId,
  { x: number; y: number; width: number; slope: number; height: number }
> = {
  PM: { x: 453.44, y: 209.08, width: 52.08, slope: -22.32 / 52.08, height: 28 },
  PLANNER: {
    x: 348.44,
    y: 254.08,
    width: 52.08,
    slope: -22.32 / 52.08,
    height: 28,
  },
  DESIGNER: {
    x: 844.88,
    y: 207.38,
    width: 44.88,
    slope: 21.93 / 44.88,
    height: 29,
  },
  DEVELOPER: {
    x: 982.16,
    y: 274.46,
    width: 44.88,
    slope: 21.93 / 44.88,
    height: 29,
  },
};
export function createDeskScreen(role: RoleId) {
  const art = new Graphics();
  art.eventMode = "none";
  const screen = screens[role];
  art.position.set(
    screen.x - SCENE_SIZE.originX,
    screen.y - SCENE_SIZE.originY,
  );
  let previous = "";
  const box = (x: number, y: number, w: number, h: number, color: number) => {
    art
      .poly([
        x,
        y + x * screen.slope,
        x + w,
        y + (x + w) * screen.slope,
        x + w,
        y + h + (x + w) * screen.slope,
        x,
        y + h + x * screen.slope,
      ])
      .fill(color);
  };
  return {
    art,
    draw(activity: DeskActivity) {
      const key = `${activity.active}:${activity.frame}`;
      if (previous === key) return;
      previous = key;
      art.clear();
      box(
        0,
        0,
        screen.width,
        screen.height,
        role === "DEVELOPER" ? 0x243d34 : 0xf1e8df,
      );
      if (role === "PM") {
        box(4, 4, 18, 2, 0x79513c);
        const heights = [5, 9, 7, 12, 10, 15];
        heights.forEach((height, i) => {
          const h =
            height + (activity.active && i === activity.frame % 6 ? 2 : 0);
          box(5 + i * 7, 24 - h, 4, h, i % 3 === 2 ? 0xbd6428 : 0x009f77);
        });
      } else if (role === "PLANNER") {
        [0, 1, 2].forEach((i) => {
          box(5, 6 + i * 7, 3, 3, 0xbd6428);
          box(12, 6 + i * 7, 20 + i * 5, 2, 0x967b60);
        });
      } else if (role === "DESIGNER") {
        box(4, 4, 12, 12, 0x783cff);
        box(7, 7, 6, 6, 0xf1e8df);
        box(20, 5, 20, 2, 0x79513c);
        box(20, 11, 14, 2, 0xa48d7c);
        [0, 1, 2, 3, 4, 5].forEach((i) => {
          const h = activity.active ? 3 + ((i + activity.frame) % 4) * 2 : 4;
          box(5 + i * 6, 25 - h, 3, h, 0x783cff);
        });
      } else {
        [0, 1, 2, 3].forEach((i) => {
          box(
            4 + (i % 2) * 4,
            5 + i * 5,
            18 + ((i + activity.frame) % 3) * 5,
            2,
            i % 2 ? 0xd9bba0 : 0x78c89e,
          );
        });
        if (activity.active && activity.frame % 2 === 0)
          box(33, 23, 3, 3, 0xf1e8df);
      }
    },
  };
}

// Contact points live on the desk plane, not on the moving character's chest.
const contacts: Record<
  RoleId,
  [{ x: number; y: number }, { x: number; y: number }]
> = {
  PM: [
    { x: 516, y: 271 },
    { x: 537, y: 262 },
  ],
  PLANNER: [
    { x: 410, y: 310 },
    { x: 432, y: 301 },
  ],
  DESIGNER: [
    { x: 855, y: 296 },
    { x: 877, y: 306 },
  ],
  DEVELOPER: [
    { x: 1016, y: 362 },
    { x: 1038, y: 373 },
  ],
};
export const deskSeatLift = (role: RoleId) =>
  role === "PM" || role === "PLANNER" ? 15 : 0;
export function deskHands(role: RoleId) {
  return contacts[role].map((p) => ({
    x: p.x - actors[role].x,
    y: p.y - actors[role].y + deskSeatLift(role),
  }));
}
export function createDeskSurface(role: RoleId) {
  const art = new Graphics();
  art.eventMode = "none";
  art.position.set(-SCENE_SIZE.originX, -SCENE_SIZE.originY);
  if (role === "PM") {
    // Bring the keyboard to the near edge instead of stretching the arms to it.
    art
      .poly([519.8, 242.36, 480.32, 259.28, 492.92, 264.68, 532.4, 247.76])
      .fill(0xffffff);
    art.poly([540, 253, 501, 270, 514, 275, 553, 258]).fill(0x967b60);
    art.poly([539, 255, 505, 270, 514, 273, 548, 258]).fill(0xeee4d8);
    for (let i = 0; i < 6; i++) {
      const x = 508 + i * 6,
        y = 269 - i * 2.6;
      art.poly([x, y, x + 4, y - 1.7, x + 4, y + 1, x, y + 2.7]).fill(0xa48d7c);
    }
  }
  if (role === "PLANNER") {
    art.position.x += 19;
    art.position.y += 6;
    // Notebook lies flat over the planner's desk pad and remains when they leave.
    art.poly([377, 303, 412, 288, 432, 297, 397, 312]).fill(0x80614b);
    art.poly([380, 302, 412, 289, 429, 297, 397, 310]).fill(0xfff9f0);
    art.poly([397, 295, 399, 294, 416, 302, 414, 303]).fill(0xb49a80);
    for (let i = 0; i < 3; i++) {
      art
        .poly([
          385 + i * 4,
          302 + i * 2,
          394 + i * 4,
          298 + i * 2,
          396 + i * 4,
          299 + i * 2,
          387 + i * 4,
          303 + i * 2,
        ])
        .fill(0xb49a80);
    }
  } else if (role === "DESIGNER") {
    // A low-profile keyboard replaces the tablet surface without moving the desk.
    art.poly([838, 292, 858, 282, 898, 302, 878, 312]).fill(0x806b60);
    art.poly([841, 292, 858, 284, 895, 302, 878, 310]).fill(0xeee4d8);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 6; col++) {
        const x = 849 + col * 6 - row * 3,
          y = 289 + col * 3 + row * 2;
        art
          .poly([x, y, x + 4, y + 2, x + 2, y + 3, x - 2, y + 1])
          .fill(0xa48d7c);
      }
  }
  return art;
}
