/** Opt-in live check: consumes Codex usage, never touches factory DB or deployment providers. */
import { createCodexWriter } from "@/infrastructure/codex/codex-writer";
import { createDockerSandbox } from "@/infrastructure/sandbox/docker-sandbox";
import { resolveLockfile, verifyBuild } from "@/application/build-verification";
import { createRedactor } from "@/domain/secrets";
import { randomUUID } from "node:crypto";
import { runCodexProcess } from "@/infrastructure/codex/codex-process";

async function main() {
  const runId = `codex-smoke-${randomUUID()}`;
  const writer = createCodexWriter({
    command: process.env.CODEX_CLI_PATH,
    model: process.env.CODEX_MODEL,
    process: async (request) => {
      const result = await runCodexProcess(request);
      if (process.argv.includes("--diagnose")) {
        console.error(createRedactor([])(result.stderr).slice(-3000));
        for (const line of result.stdout.split("\n")) {
          try {
            const event = JSON.parse(line);
            if (event.item?.type === "agent_message")
              console.error(createRedactor([])(event.item.text).slice(-1500));
          } catch {
            /* Diagnostic mode only; non-JSON output is omitted. */
          }
        }
      }
      return result;
    },
  });
  const sandbox = createDockerSandbox({
    image: "node:22-slim",
    namespace: "codex-smoke",
  });
  const redact = createRedactor([]);
  const context = {
    projectName: "Codex 연결 검증",
    idea: "숫자 두 개를 입력하면 합을 표시하는 작은 계산기. 저장·외부 연동 없음.",
    purpose: null,
    constraints: "가능한 작은 Next.js 앱. 외부 폰트·이미지·네트워크 호출 없음.",
    feedback: [],
  };
  const result = await writer.write({
    runId,
    context,
    spec: { 목적: "두 숫자의 합 표시", 데이터저장: "불필요" },
    screens: { 화면: "숫자 입력 2개와 결과" },
    documents: [],
    data: null,
    files: [],
    timeoutMs: 180_000,
  });
  console.log(
    JSON.stringify({
      stage: "codex",
      fileCount: result.files.length,
      usage: result.usage,
    }),
  );
  const files = await resolveLockfile(sandbox, runId, result.files, { redact });
  const verified = await verifyBuild(
    {
      sandbox,
      redact,
      secrets: [],
      store: { saveReport: async () => "smoke", latestItems: async () => [] },
    },
    { runId, specVersion: 1, files },
  );
  console.log(JSON.stringify({ stage: "docker", items: verified.items }));
  if (
    verified.items.some(
      (item) => item.result === "FAIL" || item.result === "NOT_RUN",
    )
  )
    process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "검증 실패");
  process.exitCode = 1;
});
