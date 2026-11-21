import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  actors,
  interpolatePoint,
  projectScene,
} from "@/components/office/scene/model";
import type { OfficeState, Meeting } from "@/contracts";
const state: OfficeState = {
  project: {
    id: "p1",
    name: "테스트",
    archived: false,
    latestRun: null,
    hasOpenDecision: false,
    createdAt: "",
    updatedAt: "",
  },
  run: null,
  roles: [],
  activeMeeting: null,
  openDecisions: [],
  latestNews: null,
  lastSequence: 0,
};
const meeting: Meeting = {
  id: "m1",
  runId: "r1",
  decisionId: null,
  topic: "회의",
  participants: ["PM", "DESIGNER"],
  status: "IN_PROGRESS",
  statements: [
    { order: 2, sequence: 4, role: "DESIGNER", summary: "화면" },
    { order: 1, sequence: 2, role: "PM", summary: "기획" },
  ],
  reactions: [],
  outcome: null,
  startedAt: "",
  endedAt: null,
};
test("no server meeting means desk positions, not invented activity", () => {
  const scene = projectScene(state, meeting);
  assert.equal(scene.meetingId, null);
  assert.deepEqual(scene.participants, []);
  for (const role of ["PM", "PLANNER", "DESIGNER", "DEVELOPER"] as const)
    assert.deepEqual(scene.targets[role], {
      x: actors[role].x,
      y: actors[role].y,
    });
});
test("only participants move to seats and latest statement uses server sequence", () => {
  const scene = projectScene({ ...state, activeMeeting: meeting }, meeting);
  assert.equal(scene.targets.PM.x, actors.PM.seatX);
  assert.equal(scene.targets.PLANNER.x, actors.PLANNER.x);
  assert.equal(scene.speaker, "DESIGNER");
  assert.equal(scene.speakerSequence, 4);
  assert.equal(
    projectScene(
      { ...state, activeMeeting: meeting },
      { ...meeting, id: "stale" },
    ).speaker,
    null,
  );
});
test("waiting keeps seats; ended returns home; interruption pauses", () => {
  assert.equal(
    projectScene({
      ...state,
      activeMeeting: { ...meeting, status: "WAITING_CEO" },
    }).targets.PM.x,
    actors.PM.seatX,
  );
  assert.equal(
    projectScene({ ...state, activeMeeting: { ...meeting, status: "ENDED" } })
      .targets.PM.x,
    actors.PM.x,
  );
  assert.equal(
    projectScene({
      ...state,
      activeMeeting: { ...meeting, status: "INTERRUPTED" },
    }).paused,
    true,
  );
});
test("motion clamps endpoints without overshoot and snapshots remain immutable", () => {
  const from = { x: 10, y: 20 },
    to = { x: 100, y: 80 };
  assert.deepEqual(interpolatePoint(from, to, -1), from);
  assert.deepEqual(interpolatePoint(from, to, 2), to);
  assert.deepEqual(interpolatePoint(from, to, 0.5), { x: 55, y: 50 });
  const before = JSON.stringify(state);
  projectScene(state);
  assert.equal(JSON.stringify(state), before);
});
