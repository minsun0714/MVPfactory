/**
 * 로컬 Docker로 만든 샌드박스(DEC-004 결정). 격리 규칙은 아래 `createArgs`에 모여 있다.
 *
 * - 호스트 폴더를 마운트하지 않는다. 파일은 표준 입력(tar)으로만 넣고 꺼낸다.
 * - 환경변수를 넘기지 않는다(팩토리 비밀값이 보이지 않는다).
 * - 권한 없는 사용자(`node`)로 실행하고, 모든 리눅스 capability를 버리고, 권한 상승을 막는다.
 * - 메모리·CPU·프로세스 수 상한을 둔다. 메모리 스왑은 쓰지 않는다.
 * - 의존성 설치 때만 외부 통신을 허용하고, 그 뒤 `cutNetwork()`로 네트워크를 끊는다.
 * - 명령마다 컨테이너 안의 `timeout`과 호스트 쪽 마감 시간을 모두 둔다.
 * - 세션 수명이 지나면 컨테이너를 강제로 지운다.
 */
import { randomUUID } from "node:crypto";
import type {
  CommandResult,
  ExportedFile,
  Sandbox,
  SandboxSession,
} from "@/application/sandbox";
import {
  DEFAULT_SANDBOX_LIMITS,
  SandboxPolicyError,
  assertSourceWithinLimits,
  tailOutput,
  type SandboxLimits,
  type SourceFileInput,
} from "@/domain/sandbox";
import { docker } from "@/infrastructure/sandbox/docker-cli";
import { decodeTar, encodeTar } from "@/infrastructure/sandbox/tar";

/** 색상 등 터미널 제어 문자를 없앤다. 사람과 모델이 읽는 로그에 필요 없다. */
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) =>
  text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

export const SANDBOX_LABEL = "mvpfactory.sandbox";
/** 기본 네임스페이스. 정리(`cleanupStale`)는 같은 네임스페이스의 샌드박스만 지운다. */
export const DEFAULT_NAMESPACE = "factory";
const WORKDIR = "/home/node/work";
/** 컨테이너 안 `timeout`이 종료 신호를 보낸 뒤 강제 종료까지 기다리는 시간(초) */
const KILL_GRACE_SECONDS = 5;
/** 호스트 쪽 마감은 컨테이너 안 마감보다 조금 더 길게 둔다. */
const HOST_MARGIN_MS = 20_000;
const EXPORT_EXCLUDES = [
  "./node_modules",
  "./.next",
  "./.git",
  "./dist",
  "./build",
  "./coverage",
];

export type DockerSandboxOptions = {
  image: string;
  /** 이 값이 같은 샌드박스끼리만 서로를 정리한다. 테스트는 다른 값을 써서 실제 실행에 영향을 주지 않는다. */
  namespace?: string;
  limits?: Partial<SandboxLimits>;
  /** 로그에 남기기 전에 비밀값을 가린다. */
  redact?: (text: string) => string;
};

function failure(
  action: string,
  result: { stderr: Buffer; code: number | null },
): Error {
  const detail = result.stderr.toString("utf8").trim().split("\n").pop() ?? "";
  return new Error(
    `샌드박스 ${action} 실패(종료 코드 ${result.code}): ${detail}`,
  );
}

export function createDockerSandbox(options: DockerSandboxOptions): Sandbox {
  const limits: SandboxLimits = {
    ...DEFAULT_SANDBOX_LIMITS,
    ...options.limits,
  };
  const redact = options.redact ?? ((text: string) => text);
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;

  async function open({ runId }: { runId: string }): Promise<SandboxSession> {
    const id = `sbx-${runId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
    const created = await docker(
      [
        "create",
        "--name",
        id,
        "--label",
        `${SANDBOX_LABEL}=${namespace}`,
        "--label",
        `mvpfactory.run=${runId}`,
        "--init",
        "--user",
        "node",
        "--workdir",
        "/home/node",
        "--memory",
        limits.memory,
        "--memory-swap",
        limits.memory,
        "--cpus",
        String(limits.cpus),
        "--pids-limit",
        String(limits.pids),
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--env",
        "CI=1",
        "--env",
        "NO_COLOR=1",
        "--env",
        "FORCE_COLOR=0",
        "--env",
        "NEXT_TELEMETRY_DISABLED=1",
        "--env",
        "npm_config_update_notifier=false",
        "--env",
        "npm_config_fund=false",
        options.image,
        "sleep",
        "infinity",
      ],
      { timeoutMs: 60_000 },
    );
    if (created.code !== 0) throw failure("생성", created);
    let alive = true;

    const remove = async () => {
      if (!alive) return;
      alive = false;
      await docker(["rm", "-f", "-v", id], { timeoutMs: 60_000 });
    };

    try {
      const started = await docker(["start", id], { timeoutMs: 60_000 });
      if (started.code !== 0) throw failure("시작", started);
      const prepared = await docker(["exec", id, "mkdir", "-p", WORKDIR], {
        timeoutMs: 30_000,
      });
      if (prepared.code !== 0) throw failure("작업 공간 준비", prepared);
    } catch (error) {
      await remove();
      throw error;
    }

    // 세션 수명 상한. 정리되지 않은 컨테이너가 남지 않게 한다.
    const lifetime = setTimeout(() => void remove(), limits.sessionTimeoutMs);
    lifetime.unref();

    const requireAlive = () => {
      if (!alive) throw new Error("이미 종료된 샌드박스입니다.");
    };

    return {
      id,

      async writeFiles(files: SourceFileInput[]) {
        requireAlive();
        assertSourceWithinLimits(files, limits);
        const result = await docker(
          ["exec", "-i", id, "tar", "-x", "-C", WORKDIR],
          {
            input: encodeTar(files),
            timeoutMs: 120_000,
          },
        );
        if (result.code !== 0) throw failure("파일 쓰기", result);
      },

      async run(
        command: string[],
        runOptions?: { timeoutMs?: number; env?: Record<string, string> },
      ): Promise<CommandResult> {
        requireAlive();
        if (command.length === 0)
          throw new SandboxPolicyError("실행할 명령이 없습니다.");
        const timeoutMs = runOptions?.timeoutMs ?? limits.commandTimeoutMs;
        const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
        const started = Date.now();
        const result = await docker(
          [
            "exec",
            "-w",
            WORKDIR,
            ...Object.entries(runOptions?.env ?? {}).flatMap(([key, value]) => {
              if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
                throw new SandboxPolicyError(
                  `환경변수 이름이 올바르지 않습니다: ${key}`,
                );
              return ["-e", `${key}=${value}`];
            }),
            id,
            "timeout",
            "-k",
            String(KILL_GRACE_SECONDS),
            String(seconds),
            ...command,
          ],
          {
            timeoutMs: timeoutMs + HOST_MARGIN_MS,
            maxBytes: limits.maxOutputBytes * 2,
          },
        );
        // 컨테이너 안 timeout이 듣지 않을 정도로 멈췄다면 컨테이너째 지운다.
        if (result.timedOut) await remove();
        const durationMs = Date.now() - started;
        // 137은 강제 종료(SIGKILL)다. 마감에 이르렀을 때만 시간 초과로 보고, 그 전이면 메모리 초과 등으로 본다.
        const reachedDeadline = durationMs >= seconds * 1000 - 500;
        const timedOut =
          result.timedOut ||
          result.code === 124 ||
          (result.code === 137 && reachedDeadline);
        const out = tailOutput(
          redact(stripAnsi(result.stdout.toString("utf8"))),
          limits.maxOutputBytes,
        );
        const err = tailOutput(
          redact(stripAnsi(result.stderr.toString("utf8"))),
          limits.maxOutputBytes,
        );
        return {
          command,
          exitCode: timedOut ? null : result.code,
          timedOut,
          durationMs,
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
        };
      },

      async cutNetwork() {
        requireAlive();
        const result = await docker(["network", "disconnect", "bridge", id], {
          timeoutMs: 30_000,
        });
        // 이미 끊겨 있으면 같은 결과이므로 오류로 보지 않는다.
        if (
          result.code !== 0 &&
          !/is not connected|not connected/i.test(
            result.stderr.toString("utf8"),
          )
        )
          throw failure("네트워크 차단", result);
      },

      async exportFiles(): Promise<ExportedFile[]> {
        requireAlive();
        const result = await docker(
          [
            "exec",
            id,
            "tar",
            "-c",
            "--format=ustar",
            "-C",
            WORKDIR,
            ...EXPORT_EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
            ".",
          ],
          { timeoutMs: 120_000, maxBytes: limits.maxSourceBytes + 1024 * 1024 },
        );
        if (result.code !== 0) throw failure("파일 꺼내기", result);
        return decodeTar(result.stdout);
      },

      dispose: remove,
    };
  }

  async function cleanupStale(olderThanMs: number): Promise<number> {
    const listed = await docker(
      [
        "ps",
        "-a",
        "--filter",
        `label=${SANDBOX_LABEL}=${namespace}`,
        "--format",
        "{{.ID}} {{.CreatedAt}}",
      ],
      { timeoutMs: 30_000 },
    );
    if (listed.code !== 0) throw failure("목록 조회", listed);
    let removed = 0;
    for (const line of listed.stdout
      .toString("utf8")
      .split("\n")
      .filter(Boolean)) {
      const [containerId] = line.split(" ");
      const inspected = await docker(
        ["inspect", "--format", "{{.Created}}", containerId],
        { timeoutMs: 30_000 },
      );
      const created = Date.parse(inspected.stdout.toString("utf8").trim());
      if (Number.isFinite(created) && Date.now() - created > olderThanMs) {
        await docker(["rm", "-f", "-v", containerId], { timeoutMs: 60_000 });
        removed += 1;
      }
    }
    return removed;
  }

  return { open, cleanupStale };
}
