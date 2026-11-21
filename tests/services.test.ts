import { strict as assert } from "node:assert";
import { test } from "node:test";
import { answerDecision } from "@/services/decisions";
import { createProject, getProject, getProjects } from "@/services/projects";

const fields = {
  name: "프로젝트",
  idea: "아이디어",
  ceoLevel: "DELEGATE",
  mode: "DEMO",
};

const requests = [
  {
    name: "list projects",
    call: () => getProjects(),
    args: ["/api/projects"],
    data: [
      {
        id: "p1",
        name: "프로젝트",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        runs: [{ status: "QUEUED" }],
      },
    ],
  },
  {
    name: "poll project",
    call: () => getProject("p1"),
    args: ["/api/projects/p1", { cache: "no-store" }],
    data: {
      name: "프로젝트",
      idea: "아이디어",
      requirements: "아이디어",
      ceoLevel: "DELEGATE",
      runs: [],
    },
  },
  {
    name: "create project",
    call: () => createProject(fields),
    args: [
      "/api/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      },
    ],
    data: { id: "p1" },
  },
  {
    name: "answer decision",
    call: () => answerDecision("d1", "승인"),
    args: [
      "/api/decisions/d1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: "승인" }),
      },
    ],
    data: { ok: true },
  },
];

for (const request of requests) {
  test(`${request.name}: returns JSON and sends the expected request`, async (t) => {
    const fetch = t.mock.method(
      globalThis,
      "fetch",
      async (...args: Parameters<typeof globalThis.fetch>) => {
        assert.deepEqual(args, request.args);
        return Response.json(request.data);
      },
    );

    assert.deepEqual(await request.call(), request.data);
    assert.equal(fetch.mock.callCount(), 1);
  });

  test(`${request.name}: propagates API, network, and JSON errors`, async (t) => {
    const networkError = new Error("network failed");
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: "API failed" }, { status: 400 }),
    );

    await assert.rejects(request.call(), { message: "API failed" });
    fetch.mock.mockImplementation(async () => {
      throw networkError;
    });
    await assert.rejects(request.call(), (error) => error === networkError);
    fetch.mock.mockImplementation(async () => new Response("not JSON"));
    await assert.rejects(request.call(), SyntaxError);
  });
}

test("answer decision preserves a missing form response", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(input, "/api/decisions/d1");
      assert.equal(init?.body, '{"response":null}');
      return Response.json({ ok: true });
    },
  );
  await answerDecision("d1", null);
});
