import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  actors,
  projectScene,
  DELIVERY_SPOT,
} from "@/components/office/scene/model";
import {
  createJourney,
  sampleJourney,
  samplePath,
  pathLength,
  WALK_SPEED,
  carriesLaptop,
} from "@/components/office/scene/motion";
import { Conversation } from "@/components/office/scene/conversation";
import type { Meeting, OfficeState, Run } from "@/contracts";
import { EMPTY_USAGE } from "@/domain/limits";
const meeting: Meeting = {
  id: "meeting",
  runId: "run",
  decisionId: null,
  topic: "검토",
  participants: ["PM", "PLANNER", "DESIGNER", "DEVELOPER"],
  status: "IN_PROGRESS",
  statements: [],
  reactions: [],
  outcome: null,
  startedAt: "",
  endedAt: null,
};
const office: OfficeState = {
  project: {
    id: "project",
    name: "프로젝트",
    archived: false,
    latestRun: null,
    hasOpenDecision: false,
    createdAt: "",
    updatedAt: "",
  },
  run: null,
  roles: [],
  activeMeeting: meeting,
  openDecisions: [],
  latestNews: null,
  lastSequence: 0,
};
const statement = (sequence: number) => ({
  sequence,
  order: sequence,
  role: "PM" as const,
  summary: `실제 발언 ${sequence}`,
});
const completedRun: Run = {
  id: "completed",
  projectId: "project",
  type: "INITIAL",
  mode: "REAL",
  status: "SUCCEEDED",
  stage: null,
  ceoLevel: "DELEGATE",
  blockedReason: null,
  failure: null,
  pauseRequested: false,
  openDecisionIds: [],
  usage: EMPTY_USAGE,
  limits: {
    maxModelCalls: null,
    maxFixAttempts: null,
    maxActiveSeconds: null,
    maxEstimatedCost: null,
  },
  lastSequence: 1,
  startedAt: null,
  finishedAt: null,
  createdAt: "",
};

test("실제 성공 때만 개발자가 결과 안내 자리로 나오고 새 작업에서는 책상으로 돌아간다", () => {
  const done = projectScene({
    ...office,
    run: completedRun,
    activeMeeting: null,
  });
  assert.equal(done.deliveryRunId, "completed");
  assert.deepEqual(done.targets.DEVELOPER, DELIVERY_SPOT);
  const walk = createJourney(
    "DEVELOPER",
    actors.DEVELOPER,
    true,
    DELIVERY_SPOT,
  );
  walk.elapsed = 10000;
  assert.deepEqual(sampleJourney(walk).point, DELIVERY_SPOT);
  for (let d = 0; d < walk.length; d += 3) {
    const { point } = samplePath(walk.path, d);
    assert.ok(
      !(point.x > 640 && point.x < 910 && point.y > 525 && point.y < 600),
    );
  }
  for (const run of [
    { ...completedRun, mode: "DEMO" as const },
    { ...completedRun, status: "FAILED" as const },
    { ...completedRun, id: "revision", status: "RUNNING" as const },
  ]) {
    const next = projectScene({ ...office, run, activeMeeting: null });
    assert.equal(next.deliveryRunId, null);
    assert.deepEqual(next.targets.DEVELOPER, {
      x: actors.DEVELOPER.x,
      y: actors.DEVELOPER.y,
    });
  }
  const back = createJourney("DEVELOPER", DELIVERY_SPOT, false);
  back.elapsed = 10000;
  assert.deepEqual(sampleJourney(back).point, {
    x: actors.DEVELOPER.x,
    y: actors.DEVELOPER.y,
  });
  assert.equal(
    projectScene({ ...office, run: completedRun }).deliveryRunId,
    null,
    "진행 중인 회의는 완료 연출로 덮지 않는다",
  );
});
test("노트북은 집어 든 뒤 이동과 복귀 내내 소지하고 책상에 놓을 때만 반환한다", () => {
  assert.equal(
    carriesLaptop(true, false, { phase: "prepare", lift: 0.3 }),
    false,
  );
  assert.equal(
    carriesLaptop(true, false, { phase: "prepare", lift: 0.8 }),
    true,
  );
  assert.equal(carriesLaptop(true, true, { phase: "walk", lift: 1 }), true);
  assert.equal(
    carriesLaptop(true, false, null),
    true,
    "완료 프로젝트 진입 시 소지 상태 복원",
  );
  assert.equal(carriesLaptop(false, true, { phase: "walk", lift: 1 }), true);
  assert.equal(
    carriesLaptop(false, true, { phase: "settle", lift: 0.2 }),
    false,
  );
  assert.equal(carriesLaptop(false, true, null), false);
  assert.equal(
    carriesLaptop(false, true, { phase: "settle", lift: 0.2 }, false),
    true,
    "회의 자리로 이동할 때는 계속 소지",
  );
  assert.equal(carriesLaptop(false, true, null, false), true);
});
const scene = (
  statements = [statement(1)],
  status: Meeting["status"] = "IN_PROGRESS",
) =>
  projectScene(
    { ...office, activeMeeting: { ...meeting, status } },
    { ...meeting, status, statements },
  );

test("journeys use distance-based speed, stagger and an exact seated endpoint", () => {
  const a = createJourney("PM", actors.PM, true);
  const b = createJourney("PLANNER", actors.PLANNER, true);
  assert.ok(b.length > a.length);
  assert.ok(b.delay > a.delay);
  assert.equal(sampleJourney(a).phase, "prepare");
  a.elapsed = 1240;
  assert.equal(sampleJourney(a).phase, "walk");
  assert.deepEqual(
    sampleJourney(a).point,
    samplePath(a.path, WALK_SPEED).point,
  );
  a.elapsed = 10000;
  assert.equal(sampleJourney(a).phase, "seated");
  assert.deepEqual(sampleJourney(a).point, {
    x: actors.PM.seatX,
    y: actors.PM.seatY,
  });
});
test("front seats approach around the sides of the table, including return journeys", () => {
  for (const role of ["PLANNER", "DEVELOPER"] as const) {
    const route = createJourney(role, actors[role], true);
    for (let d = 0; d < pathLength(route.path); d += 3) {
      const { point } = samplePath(route.path, d);
      assert.ok(
        !(point.x > 640 && point.x < 910 && point.y > 525 && point.y < 600),
        `${role} enters table footprint`,
      );
    }
    const from = samplePath(route.path, route.length / 2).point;
    const back = createJourney(role, from, false);
    assert.deepEqual(back.path[0], from);
    back.elapsed = 10000;
    assert.deepEqual(sampleJourney(back).point, {
      x: actors[role].x,
      y: actors[role].y,
    });
  }
});
test("speech waits for arrival and preserves new utterances without duplicating snapshots", () => {
  const c = new Conversation();
  c.sync(scene([statement(1), statement(2)]), false);
  c.tick(5000, false, false, false);
  assert.equal(Boolean(c.current), false);
  c.tick(16, true, false, false);
  assert.equal(c.current?.sequence, 1);
  c.sync(scene([statement(1), statement(2)]), false);
  c.tick(6000, true, false, false);
  assert.equal(c.current?.sequence, 2);
  c.tick(6000, true, false, false);
  assert.equal(c.active, false);
});
test("reload restores latest only; paused time does not consume the current utterance", () => {
  const c = new Conversation();
  c.sync(scene([statement(1), statement(2)]), true);
  assert.equal(c.current?.sequence, 2);
  assert.equal(c.active, false);
  c.sync(scene([statement(1), statement(2), statement(3)]), false);
  c.tick(16, true, false, false);
  const remaining = c.remaining;
  c.tick(5000, true, true, false);
  assert.equal(c.remaining, remaining);
});
test("reduced motion jumps to newest information and ended meetings remove speech", () => {
  const c = new Conversation();
  c.sync(scene([statement(1), statement(2), statement(3)]), false);
  c.tick(16, true, false, true);
  assert.equal(c.current?.sequence, 3);
  assert.equal(c.active, false);
  c.sync(scene([statement(3)], "ENDED"), false);
  assert.equal(Boolean(c.current), false);
  assert.equal(c.active, false);
  assert.equal(scene([statement(3)], "ENDED").speaker, null);
});
test("new meeting resets sequence and keeps the backlog bounded", () => {
  const c = new Conversation();
  c.sync(scene(Array.from({ length: 10 }, (_, i) => statement(i + 1))), false);
  c.tick(16, true, false, false);
  assert.equal(c.current?.sequence, 8);
  c.sync({ ...scene(), meetingId: "new" }, false);
  c.tick(16, true, false, false);
  assert.equal(c.current?.sequence, 1);
});

test("interrupted meetings preserve speech time and resume the same queue", () => {
  const c = new Conversation();
  c.sync(scene([statement(1), statement(2)]), false);
  c.tick(16, true, false, false);
  const remaining = c.remaining;
  c.sync(scene([statement(1), statement(2)], "INTERRUPTED"), false);
  c.tick(5000, true, true, false);
  assert.equal(c.remaining, remaining);
  assert.equal(c.current?.sequence, 1);
  c.sync(scene([statement(1), statement(2)]), false);
  c.tick(remaining + 1, true, false, false);
  assert.equal(c.current?.sequence, 2);
});

test("late meeting details restore without replaying historical reactions", () => {
  const c = new Conversation();
  c.sync(scene([]), true);
  c.sync(
    { ...scene(), reactions: [{ sequence: 2, role: "PLANNER", kind: "NOD" }] },
    false,
  );
  c.tick(16, true, false, false);
  assert.equal(c.current?.sequence, 1);
  assert.equal(c.reaction, null);
  assert.equal(c.active, false);
});
