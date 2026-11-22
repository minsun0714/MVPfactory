/**
 * 샌드박스(격리 실행 환경)의 순수 규칙. 격리 방법(Docker 등)을 모른다.
 * 생성 코드를 샌드박스에 넣고 꺼낼 때 지켜야 할 경로 규칙, 자원 한도, 소스 식별자를 정한다.
 */
import { createHash } from "node:crypto";

export type SourceFileInput = { path: string; content: Uint8Array | string };

/** 샌드박스 자원 한도. 생성 코드가 호스트를 소진하지 못하게 한다. */
export type SandboxLimits = {
  /** 컨테이너가 쓸 수 있는 메모리(바이트 단위 문자열 또는 `2g` 형식) */
  memory: string;
  cpus: number;
  /** 동시에 만들 수 있는 프로세스 수. 포크 폭탄을 막는다. */
  pids: number;
  /** 명령 하나가 쓸 수 있는 최대 시간 */
  commandTimeoutMs: number;
  /** 세션 전체 수명. 이 시간이 지나면 컨테이너를 강제로 지운다. */
  sessionTimeoutMs: number;
  /** 명령 결과에서 보관하는 출력의 최대 크기(바이트). 넘으면 끝부분만 남긴다. */
  maxOutputBytes: number;
  /** 한 번에 넣을 수 있는 소스 전체 크기 */
  maxSourceBytes: number;
  maxFiles: number;
};

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  memory: "2g",
  cpus: 2,
  pids: 512,
  commandTimeoutMs: 15 * 60 * 1000,
  sessionTimeoutMs: 45 * 60 * 1000,
  maxOutputBytes: 256 * 1024,
  maxSourceBytes: 20 * 1024 * 1024,
  maxFiles: 2000,
};

export class SandboxPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPolicyError";
  }
}

/** 작업 공간 밖으로 나가거나 환경을 깨뜨리는 경로를 거부한다. */
export function assertSafeSourcePath(path: string): void {
  if (!path || path.length > 240)
    throw new SandboxPolicyError(
      `경로 길이가 올바르지 않습니다: ${path.slice(0, 40)}`,
    );
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0"))
    throw new SandboxPolicyError(`허용되지 않은 경로입니다: ${path}`);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new SandboxPolicyError(`허용되지 않은 경로입니다: ${path}`);
}

export function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === "string"
    ? new TextEncoder().encode(content)
    : content;
}

/** 소스 전체의 크기와 개수, 경로 중복을 확인한다. */
export function assertSourceWithinLimits(
  files: SourceFileInput[],
  limits: SandboxLimits,
): void {
  if (files.length === 0) throw new SandboxPolicyError("소스 파일이 없습니다.");
  if (files.length > limits.maxFiles)
    throw new SandboxPolicyError(
      `파일이 너무 많습니다(최대 ${limits.maxFiles}개).`,
    );
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    assertSafeSourcePath(file.path);
    if (seen.has(file.path))
      throw new SandboxPolicyError(`같은 경로가 두 번 있습니다: ${file.path}`);
    seen.add(file.path);
    total += toBytes(file.content).byteLength;
  }
  if (total > limits.maxSourceBytes)
    throw new SandboxPolicyError(
      `소스가 너무 큽니다(최대 ${limits.maxSourceBytes} 바이트).`,
    );
}

/** 소스 내용의 식별자. 파일 순서와 무관하며 경로와 내용이 같으면 같다. 검증 결과를 이 소스에 묶는 데 쓴다. */
export function computeSourceDigest(files: SourceFileInput[]): string {
  const lines = files
    .map(
      (file) =>
        `${file.path}\0${createHash("sha256").update(toBytes(file.content)).digest("hex")}`,
    )
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** 출력이 한도를 넘으면 끝부분만 남긴다(오류는 보통 끝에 있다). */
export function tailOutput(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  // 잘린 위치가 글자 중간이면(연속 바이트 10xxxxxx) 다음 글자 경계까지 건너뛴다.
  let start = bytes.byteLength - maxBytes;
  while (
    start < bytes.byteLength &&
    (bytes[start] & 0b1100_0000) === 0b1000_0000
  )
    start += 1;
  return { text: bytes.subarray(start).toString("utf8"), truncated: true };
}
