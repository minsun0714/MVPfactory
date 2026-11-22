/**
 * 생성 소스를 샌드박스에서 설치·빌드·테스트하고 결과를 검증 보고서로 남긴다.
 *
 * - 결과는 **실제로 실행한 종료 코드**로만 판단한다. 에이전트의 서술은 쓰지 않는다.
 * - 의존성 설치(외부 통신 허용)가 끝나면 네트워크를 끊고 빌드·테스트를 실행한다.
 * - 팩토리의 비밀값이나 `.env` 파일이 소스에 있으면 샌드박스에 넣기 전에 멈춘다.
 * - 빌드 통과는 "코드가 빌드된다"는 뜻일 뿐이다. 제품 완료와 구분한다(`CHECK_BUILD`는 빌드만 말한다).
 */
import type { CommandResult, Sandbox } from "@/application/sandbox";
import {
  SandboxPolicyError,
  assertSourceWithinLimits,
  computeSourceDigest,
  DEFAULT_SANDBOX_LIMITS,
  tailOutput,
  type SourceFileInput,
} from "@/domain/sandbox";
import { CHECK_BUILD, CHECK_SECRETS, CHECK_TESTS } from "@/domain/results";
import { findSecretLeaks, isForbiddenSourcePath } from "@/domain/secrets";

export const HARNESS_VERSION = "docker-sandbox-0.1";

/**
 * 빌드·테스트에 넣는 공개 연결 값의 자리표시자. 샌드박스는 네트워크가 끊겨 있어 실제 DB에 닿지 않으며,
 * 생성 앱이 빌드 중에 DB에 연결하지 않는지도 함께 확인된다.
 */
const BUILD_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
  NEXT_PUBLIC_SUPABASE_SCHEMA: "app_placeholder",
};

export type VerificationResultValue =
  "PASS" | "FAIL" | "NOT_RUN" | "NOT_APPLICABLE";

export type VerificationItemDraft = {
  checkId: string;
  description: string;
  result: VerificationResultValue;
  evidence: string | null;
  reason: string | null;
};

export interface VerificationStore {
  /** 보고서와 항목을 저장하고 `verification.recorded` 이벤트를 남긴다. 보고서 ID를 돌려준다. */
  saveReport(input: {
    runId: string;
    specVersion: number;
    sourceDigest: string;
    harnessVersion: string;
    items: VerificationItemDraft[];
    /** 배포까지 확인한 보고서일 때 */
    commitSha?: string;
    deploymentId?: string;
  }): Promise<string>;
  /** 같은 Run·같은 소스로 마지막에 기록한 검증 항목 */
  latestItems(
    runId: string,
    sourceDigest: string,
  ): Promise<VerificationItemDraft[]>;
}

export type BuildVerificationDeps = {
  sandbox: Sandbox;
  store: VerificationStore;
  /** 보고서에 남기는 문장에서 비밀값을 가린다. */
  redact: (text: string) => string;
  /** 소스에 들어가면 안 되는 비밀값(값은 검사에만 쓰고 결과에 담지 않는다) */
  secrets: (string | undefined | null)[];
  timeouts?: { installMs: number; buildMs: number; testMs: number };
};

export type BuildVerificationOutcome = {
  reportId: string;
  sourceDigest: string;
  items: VerificationItemDraft[];
};

const EVIDENCE_BYTES = 2000;

function evidenceOf(
  result: CommandResult,
  redact: (text: string) => string,
): string {
  const header = result.timedOut
    ? `시간 초과(${Math.round(result.durationMs / 1000)}초)`
    : `종료 코드 ${result.exitCode}, ${Math.round(result.durationMs / 1000)}초`;
  const tail = tailOutput(
    redact(`${result.stderr}\n${result.stdout}`.trim()),
    EVIDENCE_BYTES,
  ).text;
  return tail ? `${header}\n${tail}` : header;
}

function readPackageScripts(
  files: SourceFileInput[],
): { scripts: Record<string, string> } | { error: string } {
  const file = files.find((entry) => entry.path === "package.json");
  if (!file) return { error: "package.json이 없습니다." };
  try {
    const text =
      typeof file.content === "string"
        ? file.content
        : new TextDecoder().decode(file.content);
    const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
    return { scripts: parsed.scripts ?? {} };
  } catch {
    return { error: "package.json을 읽을 수 없습니다." };
  }
}

const item = (
  checkId: string,
  description: string,
  result: VerificationResultValue,
  evidence: string | null = null,
  reason: string | null = null,
): VerificationItemDraft => ({
  checkId,
  description,
  result,
  evidence,
  reason,
});

export async function verifyBuild(
  deps: BuildVerificationDeps,
  input: { runId: string; specVersion: number; files: SourceFileInput[] },
): Promise<BuildVerificationOutcome> {
  const timeouts = deps.timeouts ?? {
    installMs: DEFAULT_SANDBOX_LIMITS.commandTimeoutMs,
    buildMs: DEFAULT_SANDBOX_LIMITS.commandTimeoutMs,
    testMs: DEFAULT_SANDBOX_LIMITS.commandTimeoutMs,
  };
  const sourceDigest = computeSourceDigest(input.files);
  const items: VerificationItemDraft[] = [];
  const save = async () => ({
    reportId: await deps.store.saveReport({
      runId: input.runId,
      specVersion: input.specVersion,
      sourceDigest,
      harnessVersion: HARNESS_VERSION,
      items,
    }),
    sourceDigest,
    items,
  });
  const stop = (build: VerificationItemDraft) => {
    items.push(
      build,
      item(
        CHECK_TESTS,
        "테스트 통과",
        "NOT_RUN",
        "빌드를 확인하지 못해 실행하지 않았습니다.",
      ),
    );
    return save();
  };

  // 1) 비밀값 검사: 샌드박스에 넣기 전에 멈춘다. 어떤 파일에 어떤 종류가 있는지만 남기고 값은 남기지 않는다.
  const forbidden = input.files
    .filter((file) => isForbiddenSourcePath(file.path))
    .map((file) => file.path);
  const leaks = findSecretLeaks(
    input.files.map((file) => ({
      path: file.path,
      content:
        typeof file.content === "string"
          ? file.content
          : new TextDecoder().decode(file.content),
    })),
    deps.secrets,
  );
  if (forbidden.length > 0 || leaks.length > 0) {
    const lines = [
      ...forbidden.map(
        (path) => `${path}: 환경 파일은 소스에 포함할 수 없습니다`,
      ),
      ...leaks.map((leak) => `${leak.path}: ${leak.kind}이(가) 들어 있습니다`),
    ];
    items.push(
      item(CHECK_SECRETS, "비밀값이 소스에 없음", "FAIL", lines.join("\n")),
    );
    return stop(
      item(
        CHECK_BUILD,
        "빌드 통과",
        "NOT_RUN",
        "비밀값 검사에 실패해 실행하지 않았습니다.",
      ),
    );
  }
  items.push(item(CHECK_SECRETS, "비밀값이 소스에 없음", "PASS"));

  // 2) 소스 규칙(경로·크기)과 필수 파일
  try {
    assertSourceWithinLimits(input.files, DEFAULT_SANDBOX_LIMITS);
  } catch (error) {
    if (!(error instanceof SandboxPolicyError)) throw error;
    return stop(item(CHECK_BUILD, "빌드 통과", "FAIL", error.message));
  }
  const pkg = readPackageScripts(input.files);
  if ("error" in pkg)
    return stop(item(CHECK_BUILD, "빌드 통과", "FAIL", pkg.error));
  if (!input.files.some((file) => file.path === "package-lock.json"))
    return stop(
      item(
        CHECK_BUILD,
        "빌드 통과",
        "FAIL",
        "package-lock.json이 없어 같은 의존성으로 다시 설치할 수 없습니다.",
      ),
    );
  if (!pkg.scripts.build)
    return stop(
      item(
        CHECK_BUILD,
        "빌드 통과",
        "FAIL",
        "package.json에 build 스크립트가 없습니다.",
      ),
    );

  // 3) 설치(외부 통신 허용) → 네트워크 차단 → 빌드 → 테스트
  const session = await deps.sandbox.open({ runId: input.runId });
  try {
    await session.writeFiles(input.files);
    const install = await session.run(
      ["npm", "ci", "--no-audit", "--no-fund"],
      { timeoutMs: timeouts.installMs },
    );
    if (install.exitCode !== 0)
      return await stop(
        item(
          CHECK_BUILD,
          "빌드 통과",
          "FAIL",
          `의존성 설치 실패\n${evidenceOf(install, deps.redact)}`,
        ),
      );

    await session.cutNetwork();
    const build = await session.run(["npm", "run", "build"], {
      timeoutMs: timeouts.buildMs,
      env: BUILD_ENV,
    });
    if (build.exitCode !== 0)
      return await stop(
        item(
          CHECK_BUILD,
          "빌드 통과",
          "FAIL",
          `빌드 실패\n${evidenceOf(build, deps.redact)}`,
        ),
      );
    items.push(
      item(
        CHECK_BUILD,
        "빌드 통과",
        "PASS",
        `설치 ${Math.round(install.durationMs / 1000)}초, 빌드 ${Math.round(build.durationMs / 1000)}초`,
      ),
    );

    if (!pkg.scripts.test) {
      items.push(
        item(
          CHECK_TESTS,
          "테스트 통과",
          "NOT_RUN",
          "package.json에 test 스크립트가 없어 실행하지 않았습니다.",
        ),
      );
    } else {
      const test = await session.run(["npm", "test"], {
        timeoutMs: timeouts.testMs,
        env: BUILD_ENV,
      });
      items.push(
        item(
          CHECK_TESTS,
          "테스트 통과",
          test.exitCode === 0 ? "PASS" : "FAIL",
          evidenceOf(test, deps.redact),
        ),
      );
    }
    return await save();
  } finally {
    await session.dispose();
  }
}

export class LockfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockfileError";
  }
}

/**
 * 모델은 `package-lock.json`을 직접 쓸 수 없으므로(해시를 지어내게 된다) 샌드박스에서 의존성을 해석해 만든다.
 * 설치 스크립트는 실행하지 않는다. 모델이 낸 lock 파일은 버리고 새로 만든 것을 쓴다.
 */
export async function resolveLockfile(
  sandbox: Sandbox,
  runId: string,
  files: SourceFileInput[],
  options: { redact: (text: string) => string; timeoutMs?: number },
): Promise<SourceFileInput[]> {
  const withoutLock = files.filter((file) => file.path !== "package-lock.json");
  const session = await sandbox.open({ runId });
  try {
    await session.writeFiles(withoutLock);
    const result = await session.run(
      [
        "npm",
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        timeoutMs: options.timeoutMs ?? DEFAULT_SANDBOX_LIMITS.commandTimeoutMs,
      },
    );
    if (result.exitCode !== 0)
      throw new LockfileError(
        `의존성을 해석하지 못했어요\n${evidenceOf(result, options.redact)}`,
      );
    const lock = (await session.exportFiles()).find(
      (file) => file.path === "package-lock.json",
    );
    if (!lock)
      throw new LockfileError("package-lock.json이 만들어지지 않았어요.");
    return [
      ...withoutLock,
      { path: "package-lock.json", content: lock.content },
    ];
  } finally {
    await session.dispose();
  }
}
