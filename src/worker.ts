/**
 * 워커 진입점. 대기 중인 Job을 가져와 실행을 진행한다.
 * 웹 서버와 별도 프로세스이며, CEO 응답을 기다리는 동안에는 작업을 붙잡지 않는다.
 * 첫 버전은 워커 하나만 실행한다(PostgreSQL advisory lock으로 보장).
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { Client } from "pg";
import { createRedactor } from "@/domain/secrets";
import { WORKER_VERSION, createWorkerRuntime } from "@/server/worker-runtime";
import { db } from "@/lib/db";

const ADVISORY_LOCK_KEY = 79148021;
const HEARTBEAT_MS = 10_000;
const IDLE_MS = 500;
async function main() {
  if (existsSync(".env")) process.loadEnvFile();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL을 설정하세요.");

  // 기본값이 없다. .env에 반드시 있어야 하며, 없거나 잘못된 값이면 DB에 연결하기 전에 멈춘다.
  const rawDelay = process.env.WORKER_DEMO_DELAY_MS;
  const demoDelayMs =
    rawDelay === undefined || rawDelay.trim() === "" ? NaN : Number(rawDelay);
  if (!Number.isFinite(demoDelayMs) || demoDelayMs < 0)
    throw new Error(
      "WORKER_DEMO_DELAY_MS를 .env에 설정하세요. (0 이상의 숫자, 단위 ms. 예: 5000)",
    );

  const lock = new Client({ connectionString });
  await lock.connect();
  const locked = await lock.query(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [ADVISORY_LOCK_KEY],
  );
  if (!locked.rows[0].acquired) {
    await lock.end();
    throw new Error("다른 워커가 이미 실행 중입니다.");
  }
  lock.on("error", (error) => {
    console.error("워커 잠금 연결 오류:", error.message);
    process.exit(1);
  });

  const runtime = await createWorkerRuntime({
    connectionString,
    demoDelayMs,
    workerId: `${hostname()}-${process.pid}`,
    log: (message) => console.log(message),
    // 로그와 실패 사유에 공급자 키나 DB 비밀번호가 섞여 나가지 않게 한다.
    redact: createRedactor([
      process.env.LLM_API_KEY,
      process.env.GITHUB_TOKEN,
      process.env.VERCEL_TOKEN,
      process.env.SUPABASE_ACCESS_TOKEN,
      decodeURIComponent(new URL(connectionString).password),
    ]),
  });

  // 이전 워커가 비정상 종료되었다면(잠금을 얻었으니 확실히 종료된 상태) 멈춰 있던 Job을 이어서 진행한다.
  const recovered = await runtime.worker.recoverInterrupted();
  if (recovered > 0)
    console.log(`중단된 작업 ${recovered}개를 다시 대기열에 넣었습니다.`);

  await runtime.worker.heartbeat(WORKER_VERSION);
  const heartbeat = setInterval(() => {
    runtime.worker
      .heartbeat(WORKER_VERSION)
      .catch((error) => console.error("heartbeat 실패:", error.message));
  }, HEARTBEAT_MS);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log("데모 워커 시작 (실제 AI 생성·외부 연동은 하지 않습니다)");
  while (!stopping) {
    const worked = await runtime.worker.runOnce();
    if (!worked) await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }

  clearInterval(heartbeat);
  await runtime.close();
  await db.$disconnect();
  await lock.end();
  console.log("워커를 종료했습니다.");
}

main().catch((error) => {
  console.error(
    "워커 시작 실패:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
