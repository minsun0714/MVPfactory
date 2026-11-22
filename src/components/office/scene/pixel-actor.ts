import { Container, Graphics } from "pixi.js";
import type { RoleId } from "@/contracts";
import { deskHands } from "@/components/office/scene/desk-life";
import type { DeskActivity } from "@/components/office/scene/desk-life";
import type { Facing } from "@/components/office/scene/motion";

export type ActorPose = {
  facing: Facing;
  standing: number;
  step: number;
  walking: boolean;
  talking: boolean;
  beat: number;
  listening: boolean;
  ambient?: DeskActivity;
  reaction?: "NOD" | "THINK" | "ALERT";
  holdingLaptop?: boolean;
};
const palettes = {
  PM: { hair: 0x66534a, shade: 0x4f4038, shirt: 0xf50079, dark: 0xa80058 },
  PLANNER: { hair: 0x806146, shade: 0x604832, shirt: 0xbd6428, dark: 0x804324 },
  DESIGNER: {
    hair: 0x816a6e,
    shade: 0x66535a,
    shirt: 0x783cff,
    dark: 0x4b239d,
  },
  DEVELOPER: {
    hair: 0x493b35,
    shade: 0x352d2b,
    shirt: 0x009f77,
    dark: 0x00664e,
  },
};
/** Articulated three-pixel artwork: no scaling/rotation of a seated silhouette. */
export function createPixelActor(role: RoleId) {
  const root = new Container();
  const shadow = new Graphics()
    .ellipse(0, 17, 23, 7)
    .fill({ color: 0x55433b, alpha: 0.15 });
  const body = new Graphics();
  root.addChild(shadow, body);
  const p = palettes[role];
  let last = "";
  function draw(pose: ActorPose) {
    const key = JSON.stringify(pose);
    if (key === last) return;
    last = key;
    body.clear();
    const back = pose.facing.startsWith("back");
    const side = pose.facing.endsWith("left") ? -1 : 1;
    const stride = pose.walking ? [0, 6, 0, -6][pose.step] : 0;
    const lift = Math.round(pose.standing * 4) * 3;
    const bob = pose.walking && pose.step % 2 ? -3 : 0;
    const activity = pose.ambient;
    const deskBeat = activity?.frame ?? 0;
    const engaged = !!activity?.active;
    const musicNod =
      role === "DESIGNER" && engaged && deskBeat % 4 === 1 ? 3 : 0;
    const nod = pose.reaction === "NOD" && pose.beat % 3 === 1 ? 3 : 0;
    const gesture = pose.talking && pose.beat % 4 < 2 ? 6 : 0;
    const skin = 0xedc3a5,
      skinShade = 0xc99075,
      trouser = 0x574640,
      shoe = 0x40332e;
    const rect = (x: number, y: number, w: number, h: number, color: number) =>
      body.rect(x, y, w, h).fill(color);
    // Feet remain anchored while the pelvis rises out of the chair.
    if (pose.standing < 0.5) {
      // Bent knees point into the seat's facing, instead of straight standing legs.
      rect(-15, -18, 18, 9, trouser);
      rect(3, -18, 18, 9, trouser);
      rect(-12 + side * 6, -9, 9, 18, trouser);
      rect(6 + side * 6, -9, 9, 18, trouser);
      rect(-15 + side * 6, 6, 18, 6, shoe);
      rect(3 + side * 6, 6, 21, 6, shoe);
    } else {
      rect(-15, -12 - lift, 12, 18 + lift + stride / 2, trouser);
      rect(6, -12 - lift, 12, 18 + lift - stride / 2, trouser);
      rect(-18 + stride / 2, 6 + stride / 2, 18, 6, shoe);
      rect(3 - stride / 2, 6 - stride / 2, 21, 6, shoe);
    }
    const torsoY = -lift + bob;
    rect(-12, -51 + torsoY, 27, 30, p.shirt);
    rect(-15, -45 + torsoY, 3, 21, p.dark);
    rect(12, -45 + torsoY, 6, 21, p.dark);
    // Pelvis overlaps both jacket and thighs through every step and sit transition.
    rect(-12, -21 + torsoY, 27, 15, trouser);
    rect(-12, -24 + torsoY, 27, 6, p.dark);
    // A straight shoulder line and small cuffs keep the outfit tailored.
    rect(-15, -51 + torsoY, 33, 6, p.shirt);
    // Arms swing in opposition to the planted foot; speech is a small hand gesture.
    // Fixed sleeve caps bridge the shoulders to the independently moving forearms.
    rect(-18, -48 + torsoY, 9, 15, p.shirt);
    rect(12, -48 + torsoY, 9, 15, p.dark);
    const leftArm = pose.walking ? -stride : 0;
    const rightArm = pose.walking ? stride : -gesture;
    if (!activity) {
      rect(-21, -48 + torsoY + leftArm, 9, 18, p.shirt);
      rect(-21, -30 + torsoY + leftArm, 9, 9, skin);
      rect(-21, -33 + torsoY + leftArm, 9, 3, 0xfff9f0);
      rect(18, -48 + torsoY + rightArm, 9, 18, p.dark);
      rect(18, -30 + torsoY + rightArm, 9, 9, skin);
      rect(18, -33 + torsoY + rightArm, 9, 3, 0xfff9f0);
      if (pose.holdingLaptop) {
        // A compact open laptop stays at chest height during the entire journey.
        const laptopY = torsoY + 6;
        rect(-18, -57 + laptopY, 51, 30, 0x55433b);
        rect(-15, -54 + laptopY, 45, 24, 0x243d34);
        rect(-9, -48 + laptopY, 27, 3, 0x78c89e);
        rect(-9, -42 + laptopY, 33, 3, 0xd9bba0);
        rect(-21, -27 + laptopY, 57, 9, 0xb6aa9b);
        rect(-18, -27 + laptopY, 51, 3, 0x795f4f);
        rect(-24, -24 + laptopY, 9, 6, skin);
        rect(30, -24 + laptopY, 9, 6, skin);
      }
    } else {
      const hands = deskHands(role);
      const segment = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        color: number,
      ) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
        for (let i = 0; i <= steps; i++) {
          rect(
            Math.round((ax + ((bx - ax) * i) / steps) / 3) * 3 - 3,
            Math.round((ay + ((by - ay) * i) / steps) / 3) * 3 - 3,
            9,
            9,
            color,
          );
        }
      };
      hands.forEach((hand, i) => {
        const sx = i === 0 ? -15 : 18;
        const sy = -45;
        const hx = Math.round(hand.x / 3) * 3;
        const hy = Math.round(hand.y / 3) * 3;
        const ex = sx + (hx - sx) * 0.5;
        const ey = sy + (hy - sy) * 0.3 + 3;
        const sleeve = i === 0 ? p.shirt : p.dark;
        segment(sx, sy, ex, ey, sleeve);
        segment(ex, ey, hx, hy + 3, sleeve);
        rect(hx - 3, hy, 9, 6, 0xfff9f0);
        // Finger motion stays on the key plane; palms never float above the desk.
        const tap = engaged && (deskBeat + i) % 2 ? 3 : 0;
        rect(hx - 3 + tap, hy - 3, 9, 6, skin);
        if (role === "PLANNER" && i === 1) {
          rect(hx + 3 + tap, hy - 9, 3, 12, 0x55433b);
          rect(hx + 3 + tap, hy + 3, 3, 3, 0x806146);
        }
      });
    }
    if (!back) {
      if (role === "PM") {
        rect(-6, -48 + torsoY, 12, 18, 0xfff9f0);
        rect(-9, -48 + torsoY, 3, 12, p.dark);
        rect(6, -48 + torsoY, 3, 12, p.dark);
        rect(0, -30 + torsoY, 3, 3, 0xfff9f0);
        rect(6, -39 + torsoY, 6, 3, 0xfff9f0);
      } else if (role === "PLANNER") {
        rect(-6, -48 + torsoY, 9, 24, 0xfff9f0);
        rect(9, -39 + torsoY, 3, 12, 0x55433b);
        rect(18, -30 + torsoY + rightArm, 15, 18, 0x80614b);
        rect(21, -27 + torsoY + rightArm, 9, 12, 0xfff9f0);
        rect(21, -24 + torsoY + rightArm, 6, 3, 0xb49a80);
      } else if (role === "DESIGNER") {
        rect(-9, -42 + torsoY, 21, 21, p.dark);
        rect(-9, -51 + torsoY, 3, 12, p.dark);
        rect(9, -51 + torsoY, 3, 12, p.dark);
        rect(-6, -33 + torsoY, 12, 3, p.shirt);
        rect(0, -39 + torsoY, 3, 12, 0xfff9f0);
        rect(18, -30 + torsoY + rightArm, 18, 15, 0x55433b);
        rect(21, -27 + torsoY + rightArm, 12, 9, 0xe7ddce);
      } else {
        rect(-6, -48 + torsoY, 12, 24, 0xfff9f0);
        rect(-12, -48 + torsoY, 3, 21, p.dark);
        rect(9, -48 + torsoY, 3, 21, p.dark);
        rect(0, -39 + torsoY, 6, 3, p.dark);
      }
    }
    // Compact jaw, a side part and aligned brows give each face a composed expression.
    const headX = side * 3;
    const headY = torsoY + nod + musicNod;
    const h = (
      x: number,
      y: number,
      w: number,
      height: number,
      color: number,
    ) => rect(x + headX, y + headY, w, height, color);
    h(-6, -57, 12, 9, skinShade);
    h(-12, -96, 24, 3, p.hair);
    h(-15, -93, 30, 6, p.hair);
    h(-18, -87, 36, 24, p.hair);
    h(-15, -63, 30, 6, back ? p.shade : skinShade);
    h(-9, -57, 18, 3, back ? p.shade : skinShade);
    if (back) {
      h(side > 0 ? 15 : -18, -75, 3, 9, skin);
      h(9, -87, 6, 24, p.shade);
      h(-12, -93, 18, 3, p.shade);
      h(-9, -60, 18, 3, p.shade);
    } else {
      h(-12, -84, 24, 24, skin);
      h(-9, -87, 18, 3, skin);
      h(-9, -60, 18, 3, skin);
      h(side < 0 ? 15 : -18, -75, 3, 9, skinShade);
      // Different, tidy fringes rather than the same round cap on all four heads.
      if (role === "PM") {
        h(-15, -90, 21, 6, p.hair);
        h(-15, -84, 6, 3, p.hair);
        h(12, -87, 3, 15, p.shade);
      } else if (role === "PLANNER") {
        h(-12, -90, 24, 3, p.hair);
        h(3, -87, 12, 3, p.hair);
        h(12, -84, 3, 6, p.shade);
      } else if (role === "DESIGNER") {
        h(-15, -87, 9, 6, p.hair);
        h(-15, -81, 3, 9, p.shade);
      } else {
        h(-12, -90, 24, 3, p.hair);
        h(-12, -87, 12, 3, p.hair);
        h(12, -87, 3, 9, p.shade);
      }
      const eyeShift = side * 3;
      const blink = pose.beat === 9;
      const brow = role === "PLANNER" ? 0x806146 : 0x66534a;
      h(-9 + eyeShift, -81, 6, 3, brow);
      h(3 + eyeShift, -81, 6, 3, brow);
      if (role === "PLANNER") {
        // Walnut frames remain legible without a heavy black band across the face.
        h(-12 + eyeShift, -78, 12, 9, 0x967b60);
        h(3 + eyeShift, -78, 12, 9, 0x967b60);
        h(-9 + eyeShift, -75, 6, 3, skin);
        h(6 + eyeShift, -75, 6, 3, skin);
        h(0 + eyeShift, -75, 3, 3, 0x967b60);
      }
      h(-6 + eyeShift, -75, blink ? 6 : 3, 3, 0x493b35);
      h(6 + eyeShift, -75, blink ? 6 : 3, 3, 0x493b35);
      h(eyeShift, -69, 3, 3, skinShade);
      // Closed neutral smile; a small mouth change only while speaking.
      h(-3 + eyeShift, -63, pose.talking && pose.beat % 2 ? 3 : 6, 3, 0x9e6b59);
    }
    if (role === "DESIGNER") {
      h(-12, -105, 21, 6, p.shirt);
      h(-18, -99, 36, 6, p.shirt);
      h(-18, -93, 36, 3, p.dark);
      h(3, -108, 3, 3, p.dark);
    }
    if (
      role === "PM" ||
      role === "DEVELOPER" ||
      (role === "DESIGNER" && activity)
    ) {
      h(-15, -96, 30, 3, 0x55433b);
      h(-18, -87, 3, 15, 0x55433b);
      h(15, -87, 3, 15, 0x55433b);
      h(-21, -78, 6, 9, role === "PM" ? 0x55433b : 0x75625b);
      if (!back) h(-21, -66, 12, 3, 0x55433b);
    }
    if (role === "DESIGNER" && activity && engaged) {
      const noteY = -90 - (deskBeat % 4) * 3;
      rect(33, noteY, 3, 12, p.dark);
      rect(27, noteY + 9, 9, 6, p.dark);
      rect(36, noteY, 6, 3, p.dark);
    }
    if (pose.reaction === "THINK") {
      rect(side * 12, -60 + headY, 6, 6, skin);
    }
    if (pose.reaction === "ALERT") {
      rect(-3, -132, 6, 12, 0xbd6428);
      rect(-3, -117, 6, 3, 0xbd6428);
    }
    shadow.alpha = pose.walking ? 0.85 : 1;
  }
  return { root, draw };
}
