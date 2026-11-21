import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { RoleId } from "@/contracts";
import {
  actors,
  interpolatePoint,
  SCENE_SIZE,
} from "@/components/office/scene/model";
import type { Point, SceneSnapshot } from "@/components/office/scene/model";
import { officeAssetBounds } from "@/components/office/scene/assets";

type AssetName = keyof typeof officeAssetBounds;
type ActorView = {
  container: Container;
  art: Sprite;
  label: Text;
  labelPlate: Graphics;
  marker: Graphics;
  from: Point;
  target: Point;
  progress: number;
  seated: boolean;
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
  let speechRemaining = 0;
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
    const names = Object.keys(officeAssetBounds) as AssetName[];
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
      const art = sprite(actor.asset);
      const person = new Container({
        eventMode: "static",
        cursor: "pointer",
        zIndex: actor.depth,
      });
      person.position.set(
        actor.x - SCENE_SIZE.originX,
        actor.y - SCENE_SIZE.originY,
      );
      art.position.set(
        officeAssetBounds[actor.asset].x - actor.x,
        officeAssetBounds[actor.asset].y - actor.y,
      );
      const marker = new Graphics().rect(-18, -116, 36, 4).fill(actor.color);
      marker.visible = false;
      person.addChild(art, marker);
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
        art,
        label,
        labelPlate,
        marker,
        from: { x: actor.x, y: actor.y },
        target: { x: actor.x, y: actor.y },
        progress: 1,
        seated: false,
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
    const snap = () => {
      for (const view of people.values()) {
        view.progress = 1;
        view.container.position.set(
          view.target.x - SCENE_SIZE.originX,
          view.target.y - SCENE_SIZE.originY,
        );
      }
      speechRemaining = 0;
      wake();
    };
    app.ticker.add((ticker) => {
      if (!snapshot) return;
      let moving = false;
      for (const [role, view] of people) {
        if (!snapshot.paused && view.progress < 1) {
          view.progress = reduce
            ? 1
            : Math.min(1, view.progress + ticker.deltaMS / 900);
          moving ||= view.progress < 1;
        }
        const point = interpolatePoint(view.from, view.target, view.progress);
        view.container.position.set(
          point.x - SCENE_SIZE.originX,
          point.y - SCENE_SIZE.originY,
        );
        view.container.zIndex =
          view.progress < 1
            ? 50
            : view.seated
              ? view.target.y < 550
                ? 31
                : 33
              : actors[role].depth;
        view.label.position.set(
          view.container.x,
          view.container.y + (view.seated && view.target.y < 550 ? -126 : 30),
        );
        view.labelPlate.position.copyFrom(view.label.position);
        view.marker.visible = snapshot.speaker === role && view.seated;
        view.marker.alpha =
          !reduce && speechRemaining > 0 && !snapshot.paused
            ? 0.7 + 0.3 * Math.sin(speechRemaining / 110)
            : 1;
      }
      if (!snapshot.paused)
        speechRemaining = Math.max(0, speechRemaining - ticker.deltaMS);
      if ((!moving && (speechRemaining === 0 || reduce)) || snapshot.paused)
        stop();
    });
    return {
      destroy,
      skip: snap,
      update(next, reduceMotion) {
        if (disposed) return;
        const first = !snapshot || snapshot.projectId !== next.projectId;
        if (snapshot && next.speakerSequence > snapshot.speakerSequence)
          speechRemaining = 900;
        reduce = reduceMotion;
        for (const [role, view] of people) {
          const target = next.targets[role];
          if (target.x !== view.target.x || target.y !== view.target.y) {
            view.from = {
              x: view.container.x + SCENE_SIZE.originX,
              y: view.container.y + SCENE_SIZE.originY,
            };
            view.target = target;
            view.progress = 0;
          }
          view.seated = next.participants.includes(role);
        }
        snapshot = next;
        if (first || reduce) snap();
        wake();
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
