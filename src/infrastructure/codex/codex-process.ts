import { spawn } from "node:child_process";

export type CodexProcessInput = {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
  timeoutMs: number;
};
export type CodexProcessResult = {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};
export type CodexProcess = (
  input: CodexProcessInput,
) => Promise<CodexProcessResult>;

/** Never inherit factory credentials, API keys, or shell startup configuration. */
export function codexEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of [
    "PATH",
    "HOME",
    "CODEX_HOME",
    "TMPDIR",
    "LANG",
    "SYSTEMROOT",
  ])
    if (env[key]) clean[key] = env[key];
  return clean;
}

export const runCodexProcess: CodexProcess = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: codexEnvironment(),
      stdio: "pipe",
      detached: process.platform !== "win32",
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    const append = (old: Buffer, chunk: Buffer) =>
      Buffer.concat([old, chunk]).subarray(-1024 * 1024);
    const stop = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        ))
          throw error;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.stdin.on("error", () => undefined);
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Codex CLI를 실행하지 못했어요. 설치와 CODEX_CLI_PATH를 확인하세요.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
    child.stdin.end(input.input);
  });
