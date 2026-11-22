import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import type { Sandbox, SandboxSession } from "@/application/sandbox";
import { SandboxPolicyError } from "@/domain/sandbox";
import { createRedactor } from "@/domain/secrets";
import { createDockerSandbox } from "@/infrastructure/sandbox/docker-sandbox";
import { dockerSkipReason } from "@tests/helpers/docker";

const skip = dockerSkipReason();
// 테스트용 네임스페이스: 실제 실행 중인 샌드박스를 정리하지 않는다.
const NAMESPACE = "test";
const sessions: SandboxSession[] = [];

function sandbox(
  limits: Parameters<typeof createDockerSandbox>[0]["limits"] = {},
  redact?: (t: string) => string,
): Sandbox {
  return createDockerSandbox({
    image: "node:22-slim",
    namespace: NAMESPACE,
    limits,
    redact,
  });
}
async function open(s: Sandbox = sandbox()): Promise<SandboxSession> {
  const session = await s.open({ runId: "test-run" });
  sessions.push(session);
  return session;
}
const inspect = (id: string) =>
  JSON.parse(execFileSync("docker", ["inspect", id]).toString())[0];
const node = (code: string) => ["node", "-e", code];

after(async () => {
  for (const session of sessions)
    await session.dispose().catch(() => undefined);
});

describe("Docker 샌드박스", { skip }, () => {
  test("파일을 넣고 명령을 실행해 종료 코드와 출력을 돌려준다", async () => {
    const session = await open();
    await session.writeFiles([
      {
        path: "hello.js",
        content:
          "console.log('안녕 ' + process.argv[2]); console.error('경고'); process.exit(3)",
      },
      { path: "sub/dir/한글.txt", content: "내용" },
    ]);
    const result = await session.run(["node", "hello.js", "세상"]);
    assert.equal(result.exitCode, 3);
    assert.equal(result.timedOut, false);
    assert.equal(result.stdout.trim(), "안녕 세상");
    assert.equal(result.stderr.trim(), "경고");
    const read = await session.run(["cat", "sub/dir/한글.txt"]);
    assert.equal(read.stdout, "내용");
  });

  test("호스트 폴더·비밀값·권한이 격리된다", async () => {
    const hostDir = mkdtempSync(join(tmpdir(), "sbx-host-"));
    const hostFile = join(hostDir, "host-secret.txt");
    writeFileSync(hostFile, "호스트 파일");
    process.env.FACTORY_CANARY_TOKEN = "canary-secret-value-123456";
    process.env.GITHUB_TOKEN = "canary-github-token-123456";
    try {
      const session = await open();
      // 설정: 마운트 없음, 모든 capability 제거, 권한 상승 금지, 자원 상한, 비권한 사용자
      const info = inspect(session.id);
      assert.deepEqual(info.Mounts, []);
      assert.deepEqual(info.HostConfig.CapDrop, ["ALL"]);
      assert.ok(info.HostConfig.SecurityOpt.includes("no-new-privileges"));
      assert.equal(info.HostConfig.Memory, 2 * 1024 ** 3);
      assert.equal(info.HostConfig.MemorySwap, 2 * 1024 ** 3);
      assert.equal(info.HostConfig.PidsLimit, 512);
      assert.equal(info.HostConfig.NanoCpus, 2e9);
      assert.equal(info.Config.User, "node");
      assert.equal(info.HostConfig.Privileged, false);

      // 동작: 호스트 파일이 보이지 않고, 환경에 비밀값이 없고, 비권한 사용자이며, 루트 권한이 없다
      assert.equal((await session.run(["test", "-e", hostFile])).exitCode, 1);
      assert.equal((await session.run(["id", "-u"])).stdout.trim(), "1000");
      const env = (await session.run(["env"])).stdout;
      assert.ok(!env.includes("canary-secret-value-123456"));
      assert.ok(!env.includes("canary-github-token-123456"));
      assert.ok(
        !/DATABASE_URL|GITHUB_TOKEN|VERCEL_TOKEN|LLM_API_KEY|SUPABASE/.test(
          env,
        ),
      );
      assert.notEqual(
        (await session.run(["touch", "/etc/should-not-write"])).exitCode,
        0,
      );
      assert.notEqual(
        (await session.run(node("process.setuid(0)"))).exitCode,
        0,
      );
    } finally {
      delete process.env.FACTORY_CANARY_TOKEN;
      delete process.env.GITHUB_TOKEN;
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  test("네트워크를 끊으면 연결이 없고, 여러 번 끊어도 오류가 아니다", async () => {
    const session = await open();
    assert.ok(
      Object.keys(inspect(session.id).NetworkSettings.Networks).length >= 1,
      "처음에는 설치를 위해 네트워크가 있다",
    );
    await session.cutNetwork();
    await session.cutNetwork();
    assert.deepEqual(inspect(session.id).NetworkSettings.Networks, {});
    const lookup = await session.run(
      node(
        "require('dns').lookup('example.com', (e) => process.exit(e ? 7 : 0))",
      ),
    );
    assert.equal(lookup.exitCode, 7, "외부 이름을 찾을 수 없어야 한다");
  });

  test("명령이 시간을 넘기면 종료하고 시간 초과로 알린다", async () => {
    const session = await open();
    const result = await session.run(["sleep", "60"], { timeoutMs: 2000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    assert.ok(
      result.durationMs < 15_000,
      `마감 안에 끝나야 한다: ${result.durationMs}ms`,
    );
    // 시간 초과 뒤에도 세션은 계속 쓸 수 있다.
    assert.equal((await session.run(["echo", "ok"])).stdout.trim(), "ok");
  });

  test("메모리 상한을 넘으면 강제 종료되고 시간 초과로 오인하지 않는다", async () => {
    const session = await open(sandbox({ memory: "96m" }));
    const result = await session.run(
      node("const a=[]; for(;;) a.push(Buffer.alloc(8*1024*1024, 1))"),
      { timeoutMs: 60_000 },
    );
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 137);
  });

  test("출력이 한도를 넘으면 끝부분만 남기고 비밀값을 가린다", async () => {
    const session = await open(
      sandbox(
        { maxOutputBytes: 2000 },
        createRedactor(["super-secret-value-99"]),
      ),
    );
    const result = await session.run(
      node(
        "console.log('앞'.repeat(5000)); console.log('토큰 super-secret-value-99 끝')",
      ),
    );
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 2003);
    assert.ok(result.stdout.includes("[비밀값]"));
    assert.ok(!result.stdout.includes("super-secret-value-99"));
  });

  test("출력의 색상 제어 문자를 없앤다", async () => {
    const session = await open();
    const result = await session.run(
      node("console.log('\\x1b[31m빨강\\x1b[0m 글자')"),
    );
    assert.equal(result.stdout.trim(), "빨강 글자");
  });

  test("위험한 경로와 너무 큰 소스는 넣기 전에 거절한다", async () => {
    const session = await open(sandbox({ maxFiles: 3 }));
    for (const files of [
      [{ path: "../escape.txt", content: "x" }],
      [{ path: "/etc/x", content: "x" }],
      [
        { path: "a", content: "1" },
        { path: "b", content: "1" },
        { path: "c", content: "1" },
        { path: "d", content: "1" },
      ],
    ])
      await assert.rejects(session.writeFiles(files), SandboxPolicyError);
    assert.equal(
      (await session.run(["ls", "-A"])).stdout.trim(),
      "",
      "거절한 소스는 아무것도 쓰지 않는다",
    );
  });

  test("작업 공간의 파일을 꺼내되 의존성과 빌드 산출물은 제외한다", async () => {
    const session = await open();
    await session.writeFiles([
      { path: "src/a.ts", content: "export const a = 1" },
      { path: "package.json", content: "{}" },
    ]);
    await session.run(
      node(
        "const fs=require('fs'); fs.writeFileSync('out.txt','생성됨'); for (const d of ['node_modules/x','.next/y','dist/z']) { fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(d+'/f.txt','제외') }",
      ),
    );
    const exported = await session.exportFiles();
    assert.deepEqual(exported.map((f) => f.path).sort(), [
      "out.txt",
      "package.json",
      "src/a.ts",
    ]);
    assert.equal(
      exported.find((f) => f.path === "out.txt")!.content.toString("utf8"),
      "생성됨",
    );
  });

  test("종료하면 컨테이너가 사라지고, 정리 명령은 같은 네임스페이스의 오래된 것만 지운다", async () => {
    const session = await open();
    const id = session.id;
    await session.dispose();
    await session.dispose(); // 여러 번 호출해도 안전하다
    assert.equal(
      execFileSync("docker", ["ps", "-a", "--filter", `name=${id}`, "-q"])
        .toString()
        .trim(),
      "",
    );
    await assert.rejects(session.run(["echo", "x"]), /이미 종료된/);

    const stale = await open();
    const other = await createDockerSandbox({
      image: "node:22-slim",
      namespace: "다른-네임스페이스",
    }).open({ runId: "other" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.equal(
        await sandbox().cleanupStale(60 * 60 * 1000),
        0,
        "오래되지 않았으면 지우지 않는다",
      );
      assert.ok((await sandbox().cleanupStale(500)) >= 1);
      assert.equal(
        execFileSync("docker", [
          "ps",
          "-a",
          "--filter",
          `name=${stale.id}`,
          "-q",
        ])
          .toString()
          .trim(),
        "",
      );
      assert.notEqual(
        execFileSync("docker", [
          "ps",
          "-a",
          "--filter",
          `name=${other.id}`,
          "-q",
        ])
          .toString()
          .trim(),
        "",
        "다른 네임스페이스는 건드리지 않는다",
      );
    } finally {
      await other.dispose();
    }
  });
});
