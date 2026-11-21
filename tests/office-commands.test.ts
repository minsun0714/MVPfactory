import { strict as assert } from "node:assert";
import { test } from "node:test";
import { officeCommands } from "@/services/office-commands";
import { officeApi, OfficeApiError } from "@/services/office-api";
test("run retries retain supplied idempotency key and revision feedback", async (t) => {
  const calls: RequestInit[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      calls.push(init);
      return Response.json({ id: "r1" });
    },
  );
  const body = {
    type: "REVISION",
    mode: "REAL",
    ceoLevel: "KEY_DECISIONS",
    feedback: "필드 추가",
  } as const;
  await officeCommands.start("p1", body, "stable-key-123");
  await officeCommands.start("p1", body, "stable-key-123");
  for (const call of calls) {
    assert.equal(
      new Headers(call.headers).get("Idempotency-Key"),
      "stable-key-123",
    );
    assert.deepEqual(JSON.parse(String(call.body)), body);
  }
});
test("company optimistic version and conflict survive API boundary", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/company/characters/PM");
    assert.equal(init.method, "PUT");
    assert.equal(JSON.parse(String(init.body)).version, 3);
    return Response.json(
      { error: { code: "VERSION_MISMATCH", message: "다른 창에서 변경됨" } },
      { status: 409 },
    );
  });
  await assert.rejects(
    officeCommands.character("PM", {
      version: 3,
      appearance: {
        body: "body-1",
        hair: "hair-short",
        outfit: "outfit-jacket",
        accessories: [],
      },
    }),
    (e) => e instanceof OfficeApiError && e.status === 409,
  );
});
test("project picker includes archived projects for restoration", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) =>
    Response.json({
      items: [{ id: url.includes("archived=true") ? "archived" : "active" }],
      nextCursor: null,
    }),
  );
  assert.deepEqual(
    (await officeApi.projects()).map((p) => p.id),
    ["active", "archived"],
  );
});
test("run controls, restoration, settings and provider checks use new endpoints", async (t) => {
  const calls: { url: string; method: string | undefined }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method });
    return Response.json({});
  });
  await officeCommands.control("r/1", "pause");
  await officeCommands.control("r/1", "resume");
  await officeCommands.control("r/1", "retry");
  await officeCommands.archive("p1", true);
  await officeCommands.archive("p1", false);
  await officeCommands.settings({ limits: { maxModelCalls: 10 } });
  await officeCommands.verify("github");
  await officeCommands.office({
    version: 2,
    layout: { expansionLevel: 1, items: [], meetingSeats: [] },
  });
  await officeCommands.scope({ idea: "독서 기록" });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      "POST /api/runs/r%2F1/pause",
      "POST /api/runs/r%2F1/resume",
      "POST /api/runs/r%2F1/retry",
      "POST /api/projects/p1/archive",
      "POST /api/projects/p1/unarchive",
      "PUT /api/settings",
      "POST /api/settings/connections/github/verify",
      "PUT /api/company/office",
      "POST /api/scope-check",
    ],
  );
});
