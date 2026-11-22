import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { MeetingStatement, RoleId } from "@/contracts";
import { actors, SCENE_SIZE } from "@/components/office/scene/model";
import type { SceneSnapshot } from "@/components/office/scene/model";
import { officeAssetBounds } from "@/components/office/scene/assets";

import { createPixelActor } from "@/components/office/scene/pixel-actor";
import {
  createJourney,
  sampleJourney,
  seatFacing,
  deskFacing,
  walkingDepth,
  carriesLaptop,
} from "@/components/office/scene/motion";
import type { Journey } from "@/components/office/scene/motion";
import {
  deskActivity,
  deskSeatLift,
  createDeskScreen,
  createDeskSurface,
} from "@/components/office/scene/desk-life";
import { Conversation } from "@/components/office/scene/conversation";

type AssetName = keyof typeof officeAssetBounds;
type ActorView = {
  container: Container;
  rig: ReturnType<typeof createPixelActor>;
  label: Text;
  labelPlate: Graphics;
  marker: Graphics;
  journey: Journey | null;
  seated: boolean;
  carryingLaptop: boolean;
};
export type OfficeScene = {
  update: (snapshot: SceneSnapshot, reduce: boolean) => void;
  skip: () => void;
  destroy: () => void;
};
/** Owns the Pixi lifecycle; no React, API calls or workflow state transitions. */
export async function createOfficeScene(
  host: HTMLDivElement,
  signal: AbortSignal,
  onRole: (role: RoleId) => void,
  onMeeting: () => void,
  onPresentation: (statement: MeetingStatement | null) => void,
  onDelivery: (runId: string | null) => void,
): Promise<OfficeScene> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const app = new Application();
  const textures: Texture[] = [];
  let initialized = false;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  let intersection: IntersectionObserver | undefined;
  let snapshot: SceneSnapshot | undefined;
  let reduce = false;
  let visible = true;
  const conversation = new Conversation();
  let presentedKey = "";
  let delivered: string | null = null;
  let clock = 0;
  const screens = new Map<RoleId, ReturnType<typeof createDeskScreen>>();
  const people = new Map<RoleId, ActorView>();
  const world = new Container({ sortableChildren: true });
  const stop = () => app.ticker?.stop();
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    intersection?.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    if (initialized)
      app.destroy(
        { removeView: true },
        { children: true, texture: false, textureSource: false },
      );
    for (const texture of textures) texture.destroy(true);
  };
  const wake = () => {
    if (!disposed && initialized && visible && !document.hidden) app.start();
  };
  const visibility = () => {
    if (document.hidden) stop();
    else wake();
  };
  try {
    await app.init({
      width: SCENE_SIZE.width,
      height: SCENE_SIZE.height,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
      autoStart: false,
    });
    initialized = true;
    if (signal.aborted) {
      destroy();
      throw new DOMException("Aborted", "AbortError");
    }
    app.ticker.maxFPS = 30;
    app.canvas.setAttribute("aria-hidden", "true");
    app.canvas.dataset.renderer = "pixi";
    host.appendChild(app.canvas);
    app.stage.addChild(world);
    // Image-backed textures are owned by this scene, not the shared Assets cache.
    const names = (Object.keys(officeAssetBounds) as AssetName[]).filter(
      (name) => !["pm", "planner", "designer", "developer"].includes(name),
    );
    const entries = await Promise.all(
      names.map(async (name) => {
        const response = await fetch(`/assets/office/layers/${name}.svg`, {
          signal,
        });
        if (!response.ok)
          throw new Error(`사무실 에셋을 불러오지 못했습니다: ${name}`);
        const url = URL.createObjectURL(await response.blob());
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          if (signal.aborted || disposed)
            throw new DOMException("Aborted", "AbortError");
          const texture = Texture.from(img);
          texture.source.scaleMode = "nearest";
          textures.push(texture);
          return [name, texture] as const;
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
    if (signal.aborted) {
      destroy();
      throw new DOMException("Aborted", "AbortError");
    }
    const assets = new Map(entries);
    function sprite(name: AssetName) {
      const texture = assets.get(name);
      if (!texture) throw new Error(`Missing office asset: ${name}`);
      const art = new Sprite(texture);
      const b = officeAssetBounds[name];
      art.position.set(b.x - SCENE_SIZE.originX, b.y - SCENE_SIZE.originY);
      return art;
    }
    const layers: [AssetName, number][] = [
      ["shell", 0],
      ["designer-desk", 10],
      ["developer-desk", 11],
      ["pm-desk", 12],
      ["planner-desk", 13],
      ["designer-chair", 20],
      ["designer-armrest", 22],
      ["developer-chair", 23],
      ["developer-armrest", 25],
      ["meeting-chairs-back", 30],
      ["meeting-table", 32],
      ["meeting-chairs-front", 34],
      ["pm-chair", 44],
      ["planner-chair", 47],
    ];
    for (const [name, depth] of layers) {
      const art = sprite(name);
      art.zIndex = depth;
      world.addChild(art);
    }
    const deskLaptop = sprite("developer-laptop");
    deskLaptop.zIndex = 19;
    deskLaptop.eventMode = "none";
    world.addChild(deskLaptop);
    const tableHit = new Container({
      eventMode: "static",
      cursor: "pointer",
      zIndex: 35,
    });
    tableHit.hitArea = new Rectangle(
      635 - SCENE_SIZE.originX,
      510 - SCENE_SIZE.originY,
      280,
      100,
    );
    tableHit.on("pointertap", onMeeting);
    world.addChild(tableHit);
    for (const role of Object.keys(actors) as RoleId[]) {
      const actor = actors[role];
      const rig = createPixelActor(role);
      const screen = createDeskScreen(role);
      screen.art.zIndex = 19;
      screens.set(role, screen);
      const surface = createDeskSurface(role);
      surface.zIndex = 19;
      world.addChild(screen.art, surface);
      const person = new Container({
        eventMode: "static",
        cursor: "pointer",
        zIndex: actor.depth,
      });
      person.position.set(
        actor.x - SCENE_SIZE.originX,
        actor.y - SCENE_SIZE.originY,
      );
      const marker = new Graphics().rect(-18, -116, 36, 4).fill(actor.color);
      marker.visible = false;
      person.addChild(rig.root, marker);
      person.hitArea = new Rectangle(-40, -110, 90, 155);
      person.on("pointertap", () => onRole(role));
      world.addChild(person);
      const label = new Text({
        text: actor.label,
        style: {
          fontFamily: "Factory Pixel, sans-serif",
          fontSize: 14,
          fill: 0x392c29,
        },
      });
      label.anchor.set(0.5, 0);
      label.zIndex = 90;
      const labelPlate = new Graphics()
        .rect(-label.width / 2 - 6, -2, label.width + 12, label.height + 4)
        .fill(0xf7f4f0);
      labelPlate.zIndex = 89;
      world.addChild(labelPlate, label);
      people.set(role, {
        container: person,
        rig,
        label,
        labelPlate,
        marker,
        journey: null,
        seated: false,
        carryingLaptop: false,
      });
    }
    const resize = () => {
      if (disposed) return;
      const width = host.clientWidth || SCENE_SIZE.width;
      const height = (width * SCENE_SIZE.height) / SCENE_SIZE.width;
      app.renderer.resize(width, height);
      world.scale.set(width / SCENE_SIZE.width);
      app.render();
    };
    observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else stop();
    });
    intersection.observe(host);
    document.addEventListener("visibilitychange", visibility);
    const publish = (statement: MeetingStatement | null) => {
      const key = statement
        ? `${snapshot?.meetingId}:${statement.sequence}:${statement.summary}`
        : "none";
      if (key !== presentedKey) {
        presentedKey = key;
        onPresentation(statement);
      }
    };
    const snap = () => {
      if (!snapshot) return;
      for (const [role, view] of people) {
        view.journey = null;
        const target = snapshot.targets[role];
        view.container.position.set(
          target.x - SCENE_SIZE.originX,
          target.y - SCENE_SIZE.originY,
        );
      }
      wake();
    };
    app.ticker.add((ticker) => {
      if (!snapshot) return;
      // A hidden tab must not consume the choreography in one giant delta.
      const dt = Math.min(ticker.deltaMS, 100);
      if (!snapshot.paused) clock += dt;
      let moving = false;
      for (const view of people.values()) {
        if (view.journey) {
          if (!snapshot.paused) view.journey.elapsed += dt;
          const pose = sampleJourney(view.journey);
          view.container.position.set(
            Math.round(pose.point.x) - SCENE_SIZE.originX,
            Math.round(pose.point.y) - SCENE_SIZE.originY,
          );
          if (pose.phase === "seated") view.journey = null;
          else moving = true;
        }
      }
      const seated = snapshot.participants.every(
        (role) => !people.get(role)?.journey,
      );
      conversation.tick(dt, seated, snapshot.paused, reduce);
      publish(seated ? conversation.current : null);
      let deskLife = false;
      for (const [role, view] of people) {
        const delivering = role === "DEVELOPER" && !!snapshot.deliveryRunId;
        const pose = view.journey ? sampleJourney(view.journey) : null;
        if (role === "DEVELOPER") {
          view.carryingLaptop = carriesLaptop(
            delivering,
            view.carryingLaptop,
            pose,
            !view.seated,
          );
          deskLaptop.visible = !view.carryingLaptop;
        }
        const point = {
          x: view.container.x + SCENE_SIZE.originX,
          y: view.container.y + SCENE_SIZE.originY,
        };
        const atDesk = !view.seated && !delivering;
        const ambient =
          atDesk && !view.journey
            ? deskActivity(role, clock, reduce || snapshot.paused)
            : undefined;
        deskLife ||= !!ambient && !reduce;
        const screen = screens.get(role);
        if (screen) {
          screen.art.visible = !!ambient;
          if (ambient) screen.draw(ambient);
        }
        const facing =
          pose?.phase === "walk"
            ? pose.facing
            : pose?.phase === "prepare"
              ? view.seated
                ? deskFacing(role)
                : seatFacing(role)
              : delivering
                ? "front-left"
                : view.seated
                  ? seatFacing(role)
                  : deskFacing(role);
        const talking =
          seated &&
          !snapshot.paused &&
          snapshot.status === "IN_PROGRESS" &&
          conversation.current?.role === role &&
          conversation.remaining > 0;
        const reacting =
          conversation.reaction?.role === role
            ? conversation.reaction.kind
            : undefined;
        const deskLift = deskSeatLift(role);
        view.rig.root.y = !pose
          ? atDesk
            ? -deskLift
            : 0
          : pose.phase === "prepare" && view.seated
            ? -deskLift * (1 - pose.lift)
            : pose.phase === "settle" && atDesk
              ? -deskLift * (1 - pose.lift)
              : 0;
        view.rig.draw({
          facing,
          ambient,
          standing:
            delivering && (!pose || pose.phase === "settle")
              ? 1
              : (pose?.lift ?? 0),
          holdingLaptop: view.carryingLaptop,
          step: pose?.step ?? 0,
          walking: pose?.phase === "walk",
          talking: talking && !reduce,
          beat: reduce ? 0 : Math.floor(clock / 180) % 12,
          listening: seated && view.seated && !talking,
          reaction: reduce ? undefined : reacting,
        });
        // Remain behind the desk chair during preparation, then enter the aisle.
        view.container.zIndex =
          pose?.phase === "prepare"
            ? view.seated
              ? actors[role].depth
              : point.y < 550
                ? 31
                : 33
            : pose?.phase === "walk"
              ? walkingDepth(point)
              : delivering
                ? 40
                : atDesk
                  ? actors[role].depth
                  : point.y < 550
                    ? 31
                    : 33;
        view.label.position.set(
          view.container.x,
          view.container.y + (point.y < 550 && view.seated ? -136 : 30),
        );
        view.labelPlate.position.copyFrom(view.label.position);
        view.label.visible = view.labelPlate.visible = !view.journey;
        view.marker.visible =
          seated && view.seated && conversation.current?.role === role;
        view.marker.alpha = 1;
      }
      const delivery =
        snapshot.deliveryRunId && !people.get("DEVELOPER")?.journey
          ? snapshot.deliveryRunId
          : null;
      if (delivery !== delivered) {
        delivered = delivery;
        onDelivery(delivery);
      }
      app.ticker.maxFPS = moving || conversation.active ? 30 : 12;
      if (
        snapshot.paused ||
        (!moving && !deskLife && (!conversation.active || reduce))
      )
        stop();
    });
    return {
      destroy,
      skip: snap,
      update(next, reduceMotion) {
        if (disposed) return;
        const first = !snapshot || snapshot.projectId !== next.projectId;
        reduce = reduceMotion;
        conversation.sync(next, first);
        for (const [role, view] of people) {
          if (first)
            view.carryingLaptop = role === "DEVELOPER" && !!next.deliveryRunId;
          const target = next.targets[role];
          const previous = snapshot?.targets[role];
          if (!previous || target.x !== previous.x || target.y !== previous.y) {
            view.journey = createJourney(
              role,
              {
                x: view.container.x + SCENE_SIZE.originX,
                y: view.container.y + SCENE_SIZE.originY,
              },
              next.participants.includes(role) ||
                (role === "DEVELOPER" && !!next.deliveryRunId),
              role === "DEVELOPER" && next.deliveryRunId ? target : undefined,
            );
          }
          view.seated =
            next.participants.includes(role) ||
            (role === "DEVELOPER" && !!next.deliveryRunId);
        }
        snapshot = next;
        if (first || reduce) snap();
        if (!next.participants.length) publish(null);
        wake();
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
