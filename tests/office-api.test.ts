import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  officeApi,
  officeList,
  officeRequest,
  OfficeApiError,
} from "@/services/office-api";

test("office lists consume all cursor pages and preserve filters", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json(
      urls.length === 1
        ? { items: [{ id: "d1" }], nextCursor: "next/id" }
        : { items: [{ id: "d2" }], nextCursor: null },
    );
  });
  const result = await officeApi.decisions();
  assert.deepEqual(
    result.map((d) => d.id),
    ["d1", "d2"],
  );
  assert.equal(urls[0], "/api/decisions?status=OPEN&limit=100");
  assert.equal(
    urls[1],
    "/api/decisions?status=OPEN&limit=100&cursor=next%2Fid",
  );
});
test("repeated cursors fail instead of polling forever", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ items: [], nextCursor: "same" }),
  );
  await assert.rejects(
    officeList("/api/projects"),
    (e: unknown) => e instanceof OfficeApiError && e.code === "INVALID_CURSOR",
  );
});
test("structured conflict error retains HTTP status and message", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: {
          code: "PROPOSAL_VERSION_MISMATCH",
          message: "최신 제안을 확인하세요.",
          retryable: false,
        },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    officeApi.respond("d/1", { proposalVersion: 2, choice: "APPROVE" }),
    (e: unknown) =>
      e instanceof OfficeApiError &&
      e.status === 409 &&
      e.code === "PROPOSAL_VERSION_MISMATCH" &&
      e.message === "최신 제안을 확인하세요.",
  );
});
test("project create and retry send the supplied idempotency key unchanged", async (t) => {
  const calls: RequestInit[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      calls.push(init);
      return Response.json({ id: "p1" });
    },
  );
  const body = {
    name: "회사",
    idea: "독서 기록",
    ceoLevel: "KEY_DECISIONS" as const,
  };
  await officeApi.create(body, "same-key-123");
  await officeApi.create(body, "same-key-123");
  for (const call of calls) {
    assert.equal(
      new Headers(call.headers).get("Idempotency-Key"),
      "same-key-123",
    );
    assert.deepEqual(JSON.parse(String(call.body)), body);
  }
});
test("decision mutation uses response endpoint, viewed version and chosen option", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ id: "d1" }),
  );
  const body = {
    proposalVersion: 7,
    choice: "SELECT_OPTION" as const,
    optionId: "retry",
    comment: "재시도",
  };
  await officeApi.respond("d/1", body);
  const call = mock.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(call[0], "/api/decisions/d%2F1/response");
  assert.equal(call[1].method, "POST");
  assert.deepEqual(JSON.parse(String(call[1].body)), body);
});
test("abort signal reaches fetch and malformed success is not treated as valid data", async (t) => {
  const controller = new AbortController();
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      assert.equal(init.signal, controller.signal);
      return Response.json(null);
    },
  );
  await assert.rejects(
    officeRequest("/api/projects", { signal: controller.signal }),
    (e: unknown) =>
      e instanceof OfficeApiError && e.code === "INVALID_RESPONSE",
  );
  assert.equal(mock.mock.calls.length, 1);
});
