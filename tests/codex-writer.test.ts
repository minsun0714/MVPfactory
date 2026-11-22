import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  writeFile,
  readFile,
  symlink,
  access,
  mkdir,
  mkdtemp,
  rm,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexWriter,
  checkCodexReady,
  codexUsage,
} from "@/infrastructure/codex/codex-writer";
import {
  codexEnvironment,
  runCodexProcess,
  type CodexProcess,
} from "@/infrastructure/codex/codex-process";
import type { CodeWriter } from "@/application/code-writer";
import { createSourceDeveloper } from "@/application/code-writer";
import { EMPTY_USAGE } from "@/domain/limits";
import { fileTool } from "@/infrastructure/codex/files-server.mjs";

const context = {
  projectName: "계산기",
  idea: "더하기",
  purpose: null,
  constraints: null,
  feedback: [],
};
const CONFIRMED = { specVersion: 1, spec: {}, screens: {} };
const input: Parameters<CodeWriter["write"]>[0] = {
  runId: "run-test",
  context,
  spec: {},
  screens: {},
  documents: [],
  data: null,
  files: [],
  timeoutMs: 10000,
};
const completed = {
  code: 0,
  timedOut: false,
  stdout: JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 21, output_tokens: 10 },
  }),
  stderr: "",
};

test("Codex 파일 결과만 수집하고 기존 로그인·격리 정책을 사용한다", async () => {
  let workspace = "";
  const process: CodexProcess = async (request) => {
    workspace = request.cwd;
    assert.equal(request.args[0], "exec");
    assert.ok(request.args.includes("--ignore-user-config"));
    assert.ok(request.args.includes("features.shell_tool=false"));
    assert.ok(
      request.args.includes("permissions.factory-source.network.enabled=false"),
    );
    assert.ok(
      !request.args.includes("--dangerously-bypass-approvals-and-sandbox"),
    );
    assert.match(request.input ?? "", /Do not return a JSON file list/);
    assert.doesNotMatch(request.input ?? "", /응답 구조:/);
    assert.match(request.input ?? "", /OAuth.*만들지 않습니다/);
    assert.match(request.input ?? "", /비공개 데이터를 공개해서 우회하지/);
    await writeFile(join(request.cwd, "package.json"), '{"name":"sample"}');
    await writeFile(join(request.cwd, "app.ts"), "export const n = 1;");
    return completed;
  };
  const result = await createCodexWriter({ process }).write(input);
  assert.deepEqual(result.files.map((f) => f.path).sort(), [
    "app.ts",
    "package.json",
  ]);
  assert.deepEqual(result.usage, { inputTokens: 21, outputTokens: 10 });
  await assert.rejects(access(workspace));
});

test("수정에 기존 소스와 실패 근거를 넘기며 전체 스냅샷을 돌려준다", async () => {
  const writer = createCodexWriter({
    process: async (request) => {
      assert.equal(await readFile(join(request.cwd, "app.ts"), "utf8"), "old");
      assert.match(request.input ?? "", /compile error/);
      assert.match(request.input ?? "", /OAuth.*만들지 않습니다/);
      assert.match(request.input ?? "", /이미 존재하는 인증과 데이터 보호/);
      await writeFile(join(request.cwd, "app.ts"), "fixed");
      return completed;
    },
  });
  const result = await writer.write({
    ...input,
    files: [
      { path: "package.json", content: "{}" },
      { path: "app.ts", content: "old" },
    ],
    evidence: "compile error",
  });
  assert.equal(
    Buffer.from(
      result.files.find((f) => f.path === "app.ts")?.content ?? "",
    ).toString(),
    "fixed",
  );
  assert.ok(result.files.some((f) => f.path === "package.json"));
});

test("빈 소스·가짜 성공·실패·시간 초과를 성공으로 처리하지 않고 작업 폴더를 정리한다", async () => {
  for (const result of [
    completed,
    { ...completed, code: 1 },
    { ...completed, timedOut: true },
    { ...completed, stdout: "done" },
  ]) {
    let workspace = "";
    const writer = createCodexWriter({
      process: async (request) => {
        workspace = request.cwd;
        return result;
      },
    });
    await assert.rejects(writer.write(input));
    await assert.rejects(access(workspace));
  }
});

test("경로 이탈·설정 파일·비밀값·심볼릭 링크를 거부한다", async () => {
  let called = false;
  const writer = createCodexWriter({
    process: async () => {
      called = true;
      return completed;
    },
  });
  await assert.rejects(
    writer.write({ ...input, files: [{ path: "../outside", content: "x" }] }),
  );
  assert.equal(called, false);
  for (const path of [
    ".env",
    ".codex/config.toml",
    "AGENTS.md",
    "secret.ts",
    "link.ts",
  ]) {
    const w = createCodexWriter({
      secrets: ["factory-secret-12345678"],
      process: async (request) => {
        await writeFile(join(request.cwd, "package.json"), "{}");
        if (path.includes("/")) await mkdir(join(request.cwd, ".codex"));
        if (path === "link.ts")
          await symlink("/etc/passwd", join(request.cwd, path));
        else
          await writeFile(
            join(request.cwd, path),
            path === "secret.ts" ? "factory-secret-12345678" : "{}",
          );
        return completed;
      },
    });
    await assert.rejects(w.write(input));
  }
});

test("Codex 환경에 팩토리 비밀값과 API 키를 상속하지 않는다", () => {
  const env = codexEnvironment({
    NODE_ENV: "test",
    HOME: "/home/me",
    PATH: "/bin",
    LLM_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    SUPABASE_ACCESS_APP_TOKEN: "secret",
    GITHUB_TOKEN: "secret",
    DATABASE_URL: "secret",
    NODE_OPTIONS: "bad",
  });
  assert.deepEqual(env, {
    NODE_ENV: "production",
    HOME: "/home/me",
    PATH: "/bin",
  });
});

test("파일 도구는 작업 폴더의 소스만 읽고 쓰며 경로 이탈과 링크를 거부한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-files-test-"));
  const outside = await mkdtemp(join(tmpdir(), "codex-outside-test-"));
  try {
    await fileTool(root, "write_file", {
      path: "app/page.tsx",
      content: "source",
    });
    assert.equal(
      await fileTool(root, "read_file", { path: "app/page.tsx" }),
      "source",
    );
    for (const path of [
      "../outside",
      "/etc/passwd",
      ".env",
      ".env.local",
      ".codex/config.toml",
      "AGENTS.md",
      "a/../b",
      "a\\b",
    ])
      await assert.rejects(
        fileTool(root, "write_file", { path, content: "x" }),
      );
    await writeFile(join(outside, "secret"), "outside data");
    await symlink(outside, join(root, "outside"));
    await assert.rejects(
      fileTool(root, "read_file", { path: "outside/secret" }),
    );
    await assert.rejects(
      fileTool(root, "write_file", { path: "outside/secret", content: "bad" }),
    );
    await link(join(outside, "secret"), join(root, "hardlink"));
    await assert.rejects(
      fileTool(root, "write_file", { path: "hardlink", content: "bad" }),
    );
    assert.equal(
      await readFile(join(outside, "secret"), "utf8"),
      "outside data",
    );
    await assert.rejects(
      fileTool(root, "write_file", {
        path: "big.ts",
        content: "x".repeat(2 * 1024 * 1024 + 1),
      }),
    );
    await fileTool(root, "delete_file", { path: "app/page.tsx" });
    await assert.rejects(access(join(root, "app/page.tsx")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("파일 도구 서버가 MCP 초기화와 파일 쓰기를 실제 표준 입출력으로 처리한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-mcp-test-"));
  try {
    const result = await runCodexProcess({
      command: process.execPath,
      args: [
        join(process.cwd(), "src/infrastructure/codex/files-server.mjs"),
        root,
      ],
      cwd: root,
      timeoutMs: 5000,
      input:
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test", version: "1" },
            },
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "write_file",
              arguments: { path: "package.json", content: "{}" },
            },
          },
        ]
          .map((value) => JSON.stringify(value))
          .join("\n") + "\n",
    });
    assert.equal(result.code, 0, result.stderr);
    const messages = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.length, 3);
    assert.equal(messages[0].result.serverInfo.name, "factory-source-files");
    assert.equal(messages[1].result.tools.length, 3);
    assert.equal(messages[2].result.isError, undefined);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), "{}");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI 준비 상태·완료 이벤트·사용량을 검증한다", async () => {
  assert.deepEqual(
    await checkCodexReady({ process: async () => completed }),
    [],
  );
  assert.match(
    (
      await checkCodexReady({
        process: async () => ({ ...completed, code: 1 }),
      })
    ).join(),
    /로그인/,
  );
  assert.throws(() => codexUsage('{"type":"turn.failed"}'), /실패/);
  assert.throws(
    () =>
      codexUsage(
        '{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":0}}',
      ),
    /완료 이벤트/,
  );
});

test("CLI 프로세스는 시간 초과 시 종료하고 없는 실행 파일은 명확히 실패한다", async () => {
  const result = await runCodexProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    cwd: process.cwd(),
    timeoutMs: 30,
  });
  assert.equal(result.timedOut, true);
  await assert.rejects(
    runCodexProcess({
      command: "/nonexistent/codex",
      args: [],
      cwd: process.cwd(),
      timeoutMs: 100,
    }),
    /Codex CLI/,
  );
});

test("개발자 호출도 Run 한도를 지키고 실패를 집계하되 API 단가를 적용하지 않는다", async () => {
  let calls = 0;
  const records: unknown[] = [];
  let maxModelCalls = 0;
  const developer = createSourceDeveloper({
    runId: "r",
    writer: {
      write: async (request) => {
        calls++;
        assert.equal(request.timeoutMs, 5000);
        throw new Error("Codex failure");
      },
    },
    store: {
      loadUsage: async () => ({
        limits: {
          maxModelCalls,
          maxFixAttempts: 3,
          maxActiveSeconds: 5,
          maxEstimatedCost: null,
        },
        usage: EMPTY_USAGE,
      }),
      recordModelCall: async (_id, record) => {
        records.push(record);
      },
    },
  });
  await assert.rejects(developer.generateSource(context, CONFIRMED), /한도/);
  assert.equal(calls, 0);
  maxModelCalls = 5;
  await assert.rejects(
    developer.generateSource(context, CONFIRMED),
    /Codex failure/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(records, [
    { inputTokens: 0, outputTokens: 0, costUsd: null },
  ]);
});

test("확정 문서를 작업 폴더에 두고, 이전 결과의 문서보다 확정본을 우선한다", async () => {
  const writer = createCodexWriter({
    process: async (request) => {
      assert.equal(
        await readFile(join(request.cwd, "docs/PRD.md"), "utf8"),
        "확정 PRD",
      );
      assert.match(
        request.input ?? "",
        /confirmed specification is in docs\/PRD\.md.*Do not edit or delete these documents/,
      );
      assert.doesNotMatch(request.input ?? "", /"구조"/);
      await writeFile(join(request.cwd, "package.json"), "{}");
      return completed;
    },
  });
  await writer.write({
    ...input,
    spec: { "핵심 기능": "APP-REQ-001 기록", 구조: "{}" },
    files: [{ path: "docs/PRD.md", content: "이전 PRD" }],
    evidence: "error",
    documents: [{ path: "docs/PRD.md", content: "확정 PRD" }],
  });
});

test("개발자는 생성과 자동 수정에 같은 확정 사양을 넘기고, 결과에 확정 문서를 넣는다", async () => {
  const requests: Parameters<CodeWriter["write"]>[0][] = [];
  const developer = createSourceDeveloper({
    runId: "r",
    writer: {
      write: async (request) => {
        requests.push(request);
        return {
          files: [
            { path: "package.json", content: "{}" },
            { path: "docs/PRD.md", content: "개발자가 바꾼 문서" },
          ],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    },
    store: {
      loadUsage: async () => ({
        limits: {
          maxModelCalls: 5,
          maxFixAttempts: 3,
          maxActiveSeconds: 600,
          maxEstimatedCost: null,
        },
        usage: EMPTY_USAGE,
      }),
      recordModelCall: async () => {},
    },
  });
  const confirmed = {
    specVersion: 4,
    spec: { 목적: "독서" },
    screens: { 화면: "목록" },
  };
  const generated = await developer.generateSource(context, confirmed);
  await developer.fixSource(context, generated, "build failed", confirmed);
  assert.deepEqual(
    requests.map((r) => [r.spec, r.screens, r.documents.map((d) => d.path)]),
    [
      [confirmed.spec, confirmed.screens, ["docs/PRD.md", "docs/DESIGN.md"]],
      [confirmed.spec, confirmed.screens, ["docs/PRD.md", "docs/DESIGN.md"]],
    ],
  );
  const prd = generated.find((f) => f.path === "docs/PRD.md");
  assert.match(String(prd?.content), /확정 사양 버전 4/);
});
