import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "@/domain/errors";
import { deriveRoleStates } from "@/domain/office";
import { buildResult } from "@/domain/results";
import { createConnectionProbe } from "@/infrastructure/integrations/connection-probe";

const FIXED = () => new Date("2026-11-21T00:00:00Z");

async function withToken<T>(
  name: string,
  value: string | undefined,
  fn: () => Promise<T>,
) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

const reply = (status: number, body: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("연결 확인: 키가 없으면 공급자를 호출하지 않고 연결 안 됨", async () => {
  let called = false;
  const probe = createConnectionProbe(
    (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch,
    FIXED,
  );
  const result = await withToken("GITHUB_TOKEN", undefined, () =>
    probe.check("github"),
  );
  assert.equal(result.status, "NOT_CONNECTED");
  assert.equal(called, false);
});

test("연결 확인: 응답 코드에 따라 상태를 나누고 비밀 키는 결과에 담지 않는다", async () => {
  const secret = "ghp_super_secret_value";
  let seenAuth = "";
  const ok = createConnectionProbe(
    (async (_url: string, init?: RequestInit) => {
      seenAuth = String(
        (init?.headers as Record<string, string>).Authorization,
      );
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
      });
    }) as unknown as typeof fetch,
    FIXED,
  );
  const connected = await withToken("GITHUB_TOKEN", secret, () =>
    ok.check("github"),
  );
  assert.equal(connected.status, "CONNECTED");
  assert.equal(connected.target, "octocat");
  assert.equal(connected.checkedAt, "2026-11-21T00:00:00.000Z");
  assert.equal(seenAuth, `Bearer ${secret}`);
  assert.ok(!JSON.stringify(connected).includes(secret));

  const run = (status: number) =>
    withToken("VERCEL_TOKEN", secret, () =>
      createConnectionProbe(reply(status), FIXED).check("vercel"),
    );
  assert.equal((await run(401)).status, "DISCONNECTED");
  assert.equal((await run(403)).status, "INSUFFICIENT_PERMISSION");
  for (const status of [500, 502]) {
    await assert.rejects(
      run(status),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "SERVICE_UNAVAILABLE" &&
        error.retryable,
    );
  }
  const failing = createConnectionProbe(
    (async () => {
      throw new Error(`네트워크 오류 ${secret}`);
    }) as unknown as typeof fetch,
    FIXED,
  );
  await assert.rejects(
    withToken("SUPABASE_ACCESS_APP_TOKEN", secret, () =>
      failing.check("supabase"),
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "SERVICE_UNAVAILABLE" &&
      !error.message.includes(secret),
  );
});

test("연결 확인: 공급자별 대상 이름을 읽는다", async () => {
  const vercel = await withToken("VERCEL_TOKEN", "t", () =>
    createConnectionProbe(
      reply(200, { user: { username: "dev" } }),
      FIXED,
    ).check("vercel"),
  );
  assert.equal(vercel.target, "dev");
  const supabase = await withToken("SUPABASE_ACCESS_APP_TOKEN", "t", () =>
    createConnectionProbe(
      reply(200, [{ name: "내 조직" }, { name: "다른" }]),
      FIXED,
    ).check("supabase"),
  );
  assert.equal(supabase.target, "내 조직");
});

test("역할 상태는 마지막 단계 이벤트와 Run 상태에서 계산한다", () => {
  const started = { type: "step.started", summary: "작업 중" } as const;
  const completed = { type: "step.completed", summary: "끝" } as const;
  const roles = (
    status: Parameters<typeof deriveRoleStates>[0],
    act = { PM: started },
  ) =>
    Object.fromEntries(
      deriveRoleStates(status, act, {}).map((r) => [r.role, r.status]),
    );
  assert.deepEqual(roles(null), {
    PM: "IDLE",
    PLANNER: "IDLE",
    DESIGNER: "IDLE",
    DEVELOPER: "IDLE",
  });
  assert.equal(roles({ status: "RUNNING" }).PM, "WORKING");
  assert.equal(roles({ status: "WAITING_CEO" }).PM, "WAITING");
  assert.equal(roles({ status: "PAUSED" }).PM, "WAITING");
  assert.equal(roles({ status: "FAILED" }).PM, "FAILED");
  assert.equal(
    roles({ status: "RUNNING" }, { PM: completed } as never).PM,
    "DONE",
  );
  assert.equal(roles({ status: "RUNNING" }).PLANNER, "IDLE");
});

test("결과 계산: 데모는 완료가 될 수 없고 FAIL이 있으면 미완료다", () => {
  const base = {
    latestRun: { id: "r", status: "SUCCEEDED", mode: "REAL" },
    items: [
      { id: "BUILD", description: "빌드", result: "PASS" },
      { id: "FINAL_URL", description: "최종 URL", result: "PASS" },
      { id: "APP-AC-001", description: "기록 생성", result: "PASS" },
    ],
    publishedDeployment: { id: "d", url: "https://a.example", commitSha: "c" },
    repository: { url: "https://github.com/a/b", visibility: "PRIVATE" },
    databaseResource: null,
    lastGood: null,
  } as const;
  assert.equal(
    buildResult({ ...base, items: [...base.items] }).completion.product,
    "COMPLETE",
  );
  assert.equal(
    buildResult({
      ...base,
      items: [...base.items],
      latestRun: { ...base.latestRun, mode: "DEMO" },
    }).completion.product,
    "NOT_VERIFIED",
  );
  assert.equal(
    buildResult({
      ...base,
      items: [...base.items],
      latestRun: { ...base.latestRun, status: "RUNNING" },
    }).completion.product,
    "NOT_VERIFIED",
  );
  assert.equal(
    buildResult({
      ...base,
      items: [
        ...base.items,
        { id: "APP-AC-002", description: "x", result: "FAIL" },
      ],
    }).completion.product,
    "INCOMPLETE",
  );
  // 필수 요구사항 항목이 하나도 없으면 완료로 보지 않는다.
  assert.equal(
    buildResult({ ...base, items: base.items.slice(0, 2) as never }).completion
      .product,
    "NOT_VERIFIED",
  );
  // 배포 기록이 없으면 최종 URL 검사가 통과여도 배포 성공으로 보지 않는다.
  assert.equal(
    buildResult({ ...base, items: [...base.items], publishedDeployment: null })
      .completion.deployment,
    "NOT_RUN",
  );
});

test("Supabase는 생성 앱 토큰만 사용하고 기존 토큰으로 대체하지 않는다", async () => {
  let auth = "";
  const probe = createConnectionProbe(
    (async (_url, init) => {
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(JSON.stringify([{ name: "app organization" }]));
    }) as typeof fetch,
    FIXED,
  );
  await withToken("SUPABASE_ACCESS_TOKEN", "legacy-token", async () => {
    await withToken("SUPABASE_ACCESS_APP_TOKEN", undefined, async () => {
      const result = await probe.check("supabase");
      assert.equal(result.status, "NOT_CONNECTED");
      assert.match(result.message ?? "", /SUPABASE_ACCESS_APP_TOKEN/);
      assert.equal(auth, "");
    });
    await withToken("SUPABASE_ACCESS_APP_TOKEN", "app-token", async () => {
      assert.equal((await probe.check("supabase")).status, "CONNECTED");
      assert.equal(auth, "Bearer app-token");
    });
  });
});
