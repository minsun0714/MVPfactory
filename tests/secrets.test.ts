import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createWorker } from "@/application/worker";
import type { ClaimedJob, WorkflowStore } from "@/application/workflow-ports";
import {
  createRedactor,
  findSecretLeaks,
  isForbiddenSourcePath,
} from "@/domain/secrets";

const GH = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const SECRET = "vercel-secret-token-value-xyz";

test("비밀값과 알려진 토큰 형식을 가리고, 짧은 값이나 없는 값은 건드리지 않는다", () => {
  const redact = createRedactor([SECRET, "abc", undefined, ""]);
  assert.equal(redact(`토큰 ${SECRET} 로 요청`), "토큰 [비밀값] 로 요청");
  assert.equal(redact(`GitHub ${GH} 노출`), "GitHub [비밀값] 노출");
  assert.equal(redact("abc는 짧아서 그대로"), "abc는 짧아서 그대로");
  assert.equal(redact("비밀 없는 문장"), "비밀 없는 문장");
  assert.equal(createRedactor([])("그대로"), "그대로");
  // 같은 값이 여러 번 나와도 모두 가린다.
  assert.equal(redact(`${SECRET} ${SECRET}`), "[비밀값] [비밀값]");
});

test("소스 파일 검사는 어느 파일에 어떤 종류가 있는지만 알려 주고 값은 담지 않는다", () => {
  const leaks = findSecretLeaks(
    [
      {
        path: "src/app/page.tsx",
        content: "export default function Page() { return null }",
      },
      { path: "src/lib/config.ts", content: `const key = "${SECRET}";` },
      { path: "README.md", content: `토큰은 ${GH} 입니다` },
      { path: "keys/id", content: "-----BEGIN RSA PRIVATE KEY-----\nabc" },
    ],
    [SECRET],
  );
  assert.deepEqual(
    leaks.map((leak) => [leak.path, leak.kind]),
    [
      ["src/lib/config.ts", "팩토리 비밀값"],
      ["README.md", "GitHub 토큰"],
      ["keys/id", "개인 키"],
    ],
  );
  assert.ok(!JSON.stringify(leaks).includes(SECRET));
  assert.ok(!JSON.stringify(leaks).includes(GH));
  assert.deepEqual(
    findSecretLeaks([{ path: "a.ts", content: "const x = 1" }], [SECRET]),
    [],
  );
});

test("환경 파일은 저장소에 올리지 않고 예시 파일만 허용한다", () => {
  for (const path of [".env", ".env.local", "apps/web/.env.production"])
    assert.equal(isForbiddenSourcePath(path), true, path);
  for (const path of [".env.example", "src/env.ts", "docs/env.md"])
    assert.equal(isForbiddenSourcePath(path), false, path);
});

test("워커가 남기는 로그와 실패 사유에서 비밀값을 가린다", async () => {
  const logs: string[] = [];
  const failures: string[] = [];
  const job: ClaimedJob = { id: "j", runId: "r", kind: "START", claimEpoch: 1 };
  const store = {
    claimJob: async () => job,
    loadRun: async () => ({ id: "r", status: "QUEUED" }),
    startRun: async () => true,
    failRun: async (_: string, failure: { message: string }) =>
      void failures.push(failure.message),
    finishJob: async (_: ClaimedJob, outcome: { error?: string }) =>
      void failures.push(`job:${outcome.error}`),
    addActiveSeconds: async () => undefined,
  } as unknown as WorkflowStore;
  const worker = createWorker({
    store,
    engine: {
      advance: async () =>
        Promise.reject(new Error(`공급자 호출 실패: Bearer ${SECRET}`)),
    },
    workerId: "w",
    log: (message) => logs.push(message),
    redact: createRedactor([SECRET]),
  });
  await worker.runOnce();
  const everything = [...logs, ...failures].join("\n");
  assert.ok(!everything.includes(SECRET), "비밀값이 남으면 안 된다");
  assert.match(everything, /\[비밀값\]/);
});
