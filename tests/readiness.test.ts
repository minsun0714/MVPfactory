import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { SettingsRepository } from "@/application/ports";
import type { Connection, Provider, Settings } from "@/contracts";
import { evaluateReadiness, type RequirementFacts } from "@/domain/readiness";
import { ADAPTERS } from "@/infrastructure/integrations/adapters";
import { createIntegrationReadiness } from "@/infrastructure/integrations/readiness";

const clean = (id: RequirementFacts["id"]): RequirementFacts => ({
  id,
  label: id,
  undecided: [],
  missingAdapters: [],
  missingCredentials: [],
  unverifiedConnection: null,
  missingSettings: [],
});

test("모든 항목이 갖춰졌을 때만 준비됨이고, 하나라도 빠지면 정확한 이유를 돌려준다", () => {
  const ready = evaluateReadiness([clean("LLM"), clean("GITHUB")]);
  assert.equal(ready.available, true);
  assert.equal(ready.reason, null);

  const blocked = evaluateReadiness([
    clean("LLM"),
    {
      ...clean("GITHUB"),
      missingCredentials: ["GITHUB_TOKEN"],
      missingAdapters: ["저장소 어댑터"],
    },
  ]);
  assert.equal(blocked.available, false);
  assert.match(blocked.reason!, /GITHUB_TOKEN/);
  assert.match(blocked.reason!, /저장소 어댑터 미구현/);
  assert.equal(blocked.requirements.find((r) => r.id === "LLM")!.ready, true);
  assert.deepEqual(
    blocked.requirements.find((r) => r.id === "GITHUB")!.blockers,
    ["저장소 어댑터 미구현", ".env의 GITHUB_TOKEN 비어 있음"],
  );
});

test("미정 결정·연결 확인·설정 누락도 각각 준비를 막는다", () => {
  for (const patch of [
    { undecided: ["DEC-002 AI 연결 방식"] },
    { unverifiedConnection: "연결 확인을 아직 하지 않았어요" },
    { missingSettings: ["예상 비용 한도"] },
  ] satisfies Partial<RequirementFacts>[]) {
    const result = evaluateReadiness([{ ...clean("LLM"), ...patch }]);
    assert.equal(result.available, false);
    assert.equal(result.requirements[0].blockers.length, 1);
  }
});

const connection = (
  provider: Provider,
  over: Partial<Connection> = {},
): Connection => ({
  provider,
  status: "CONNECTED",
  target: "me",
  checkedAt: new Date().toISOString(),
  message: null,
  ...over,
});
const settings = (
  connections: Connection[],
  limits: Partial<Settings["limits"]> = {},
): SettingsRepository => ({
  get: async () => ({
    connections,
    repoVisibility: "PRIVATE",
    limits: {
      maxModelCalls: 50,
      maxFixAttempts: 3,
      maxActiveSeconds: 3600,
      maxEstimatedCost: 10,
      ...limits,
    },
    updatedAt: new Date().toISOString(),
  }),
  update: async () => {
    throw new Error("사용하지 않음");
  },
  saveConnection: async () => {
    throw new Error("사용하지 않음");
  },
});

async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>,
) {
  const saved = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}

const NO_KEYS = {
  LLM_API_KEY: undefined,
  GITHUB_TOKEN: undefined,
  VERCEL_TOKEN: undefined,
  SUPABASE_ACCESS_TOKEN: undefined,
};
const SECRET = "sk-very-secret-value-123";
const ALL_KEYS = {
  LLM_API_KEY: SECRET,
  GITHUB_TOKEN: SECRET,
  VERCEL_TOKEN: SECRET,
  SUPABASE_ACCESS_TOKEN: SECRET,
};
const allConnected = (["github", "vercel", "supabase"] as const).map((p) =>
  connection(p),
);

test("현재 상태: 어댑터와 결정이 없어 실행할 수 없고, 필요한 것을 이름으로 알려 준다(비밀값 없이)", async () => {
  const readiness = createIntegrationReadiness({ settings: settings([]) });
  const result = await withEnv(NO_KEYS, () => readiness.assess!());
  assert.equal(result.available, false);
  assert.equal(
    await withEnv(NO_KEYS, () => readiness.isRealModeAvailable()),
    false,
  );
  for (const expected of [
    "DEC-002",
    "DEC-004",
    "DEC-005",
    "LLM_API_KEY",
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "SUPABASE_ACCESS_TOKEN",
    "연결 확인",
  ])
    assert.ok(
      result.reason!.includes(expected),
      `이유에 ${expected}가 있어야 한다`,
    );
});

test("토큰과 연결 확인과 한도를 모두 채워도 어댑터가 없으면 준비되지 않는다", async () => {
  // 어댑터 구현 여부는 코드의 사실이다. 이 테스트는 그 사실이 바뀌면 함께 갱신해야 한다.
  assert.equal(
    Object.values(ADAPTERS).some((adapter) => adapter.implemented),
    false,
  );
  const readiness = createIntegrationReadiness({
    settings: settings(allConnected),
  });
  const result = await withEnv(ALL_KEYS, () => readiness.assess!());
  assert.equal(result.available, false);
  assert.match(result.reason!, /어댑터 미구현/);
  assert.ok(!result.reason!.includes(SECRET), "비밀값이 이유에 나오면 안 된다");
  assert.ok(!JSON.stringify(result).includes(SECRET));
  const llm = result.requirements.find((r) => r.id === "LLM")!;
  assert.ok(
    !llm.blockers.some((b) => b.includes("LLM_API_KEY")),
    "키가 있으면 키 누락은 막는 이유가 아니다",
  );
});

test("연결 확인이 실패했거나 오래되었거나 한도가 없으면 각각 이유로 나온다", async () => {
  const stale = connection("github", {
    checkedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  });
  const bad = [
    stale,
    connection("vercel", { status: "DISCONNECTED" }),
    connection("supabase", { status: "INSUFFICIENT_PERMISSION" }),
  ];
  const result = await withEnv(ALL_KEYS, () =>
    createIntegrationReadiness({
      settings: settings(bad, { maxModelCalls: null, maxEstimatedCost: null }),
    }).assess!(),
  );
  const blockers = (id: string) =>
    result.requirements.find((r) => r.id === id)!.blockers.join(" | ");
  assert.match(blockers("GITHUB"), /오래되었어요/);
  assert.match(blockers("VERCEL"), /해제되었어요/);
  assert.match(blockers("SUPABASE"), /권한이 부족해요/);
  assert.match(blockers("LIMITS"), /모델 호출 횟수 한도/);
  assert.match(blockers("LIMITS"), /예상 비용 한도/);
});
