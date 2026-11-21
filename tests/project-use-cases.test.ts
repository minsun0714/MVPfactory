import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createProjectUseCases } from "@/application/projects";
import {
  decisionOutcome,
  parseProject,
  parseDecisionResponse,
  RequestError,
} from "@/domain/requests";
import { POST as createProject } from "@/app/api/projects/route";
import { POST as answerDecision } from "@/app/api/decisions/[id]/route";

const valid = {
  name: " 이름 ",
  idea: " 아이디어 ",
  ceoLevel: "DELEGATE",
  mode: "DEMO",
};

test("project input rejects malformed values and real execution", () => {
  assert.deepEqual(parseProject(valid), {
    name: "이름",
    idea: "아이디어",
    ceoLevel: "DELEGATE",
  });
  for (const input of [
    null,
    [],
    1,
    {},
    { ...valid, name: " " },
    { ...valid, name: "x".repeat(101) },
    { ...valid, idea: "x".repeat(4001) },
    { ...valid, ceoLevel: "unknown" },
    { ...valid, mode: "REAL" },
  ]) {
    assert.throws(() => parseProject(input), RequestError);
  }
  for (const input of [
    null,
    [],
    { response: " " },
    { response: "x".repeat(4001) },
  ]) {
    assert.throws(() => parseDecisionResponse(input), RequestError);
  }
  assert.equal(parseDecisionResponse({ response: " 승인 " }), "승인");
});

test("decision policy preserves duplicate responses and rejects conflicting or premature answers", () => {
  assert.equal(decisionOutcome(null, "yes"), "missing");
  assert.equal(
    decisionOutcome(
      { status: "PENDING", response: null, runStatus: "WAITING" },
      "yes",
    ),
    "pending",
  );
  assert.equal(
    decisionOutcome(
      { status: "PENDING", response: null, runStatus: "RUNNING" },
      "yes",
    ),
    "conflict",
  );
  assert.equal(
    decisionOutcome(
      { status: "ANSWERED", response: "yes", runStatus: "COMPLETED" },
      "yes",
    ),
    "accepted",
  );
  assert.equal(
    decisionOutcome(
      { status: "ANSWERED", response: "yes", runStatus: "QUEUED" },
      "no",
    ),
    "conflict",
  );
});

test("use cases propagate trusted ownership and map missing/conflicting decisions", async () => {
  const calls: unknown[] = [];
  const app = createProjectUseCases(
    {
      async list(ownerId) {
        calls.push(ownerId);
        return [];
      },
      async find(id, ownerId) {
        calls.push([id, ownerId]);
        return null;
      },
      async create(input, ownerId) {
        calls.push([input, ownerId]);
        return { id: "created" };
      },
      async answer(id, response, ownerId) {
        calls.push([id, response, ownerId]);
        return id === "missing"
          ? "missing"
          : id === "conflict"
            ? "conflict"
            : "accepted";
      },
    },
    "trusted-owner",
  );
  assert.deepEqual(await app.create({ ...valid, ownerId: "untrusted" }), {
    id: "created",
  });
  assert.deepEqual(calls[0], [parseProject(valid), "trusted-owner"]);
  await app.list();
  assert.equal(calls[1], "trusted-owner");
  await assert.rejects(app.find("missing"), { status: 404 });
  assert.deepEqual(await app.answer("ok", { response: " yes " }), { ok: true });
  assert.deepEqual(calls[3], ["ok", "yes", "trusted-owner"]);
  await assert.rejects(app.answer("missing", { response: "yes" }), {
    status: 404,
  });
  await assert.rejects(app.answer("conflict", { response: "yes" }), {
    status: 409,
  });
});

test("API rejects invalid JSON and non-object bodies before database access", async () => {
  for (const [body, contentType, status] of [
    ["{", "application/json", 400],
    ["null", "application/json", 400],
    ["[]", "application/json", 400],
    ["{}", "text/plain", 415],
  ] as const) {
    const request = () =>
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    assert.equal((await createProject(request())).status, status);
    assert.equal(
      (
        await answerDecision(request(), {
          params: Promise.resolve({ id: "test" }),
        })
      ).status,
      status,
    );
  }
});
