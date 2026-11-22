import { spawn } from "node:child_process";

export type DockerResult = {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  /** 호스트가 정한 시간 안에 끝나지 않아 클라이언트를 종료했다. */
  timedOut: boolean;
};

export type DockerOptions = {
  input?: Buffer;
  timeoutMs: number;
  /** 수집하는 출력의 최대 바이트. 넘치는 앞부분은 버리고 끝부분만 남긴다. */
  maxBytes?: number;
};

/** 가장 끝 `max` 바이트만 유지하는 수집기 */
function createCollector(max: number) {
  let chunks: Buffer[] = [];
  let size = 0;
  return {
    push(chunk: Buffer) {
      chunks.push(chunk);
      size += chunk.byteLength;
      while (size - chunks[0].byteLength >= max && chunks.length > 1) {
        size -= chunks[0].byteLength;
        chunks = chunks.slice(1);
      }
    },
    result: () => {
      const all = Buffer.concat(chunks);
      return all.byteLength > max ? all.subarray(all.byteLength - max) : all;
    },
  };
}

/** docker 클라이언트에 넘기는 환경. 팩토리의 비밀값이 섞이지 않도록 필요한 것만 명시한다. */
function dockerEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
  if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST;
  return env as NodeJS.ProcessEnv;
}

/**
 * `docker` 명령을 셸 없이 실행한다. 인자는 배열로만 넘기므로 명령 주입이 생기지 않는다.
 * 비밀값을 환경으로 넘기지 않는다(필요한 환경변수만 명시한다).
 */
export function docker(
  args: string[],
  options: DockerOptions,
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: "pipe",
      env: dockerEnv(),
    });
    const max = options.maxBytes ?? 4 * 1024 * 1024;
    const out = createCollector(max);
    const err = createCollector(max);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`docker를 실행하지 못했습니다: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out.result(), stderr: err.result(), timedOut });
    });
    child.stdin.on("error", () => undefined); // 컨테이너가 먼저 끝나면 쓰기가 실패할 수 있다.
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
