import { Client } from "pg";
import { existsSync } from "node:fs";
import { db } from "@/lib/db";
import { createWorkflow, processRun } from "@/lib/workflow";

async function main() {
  if (existsSync(".env")) process.loadEnvFile();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL을 설정하세요.");
  const lock = new Client({ connectionString });
  await lock.connect();
  const result = await lock.query(
    "SELECT pg_try_advisory_lock(79148021) AS acquired",
  );
  if (!result.rows[0].acquired)
    throw new Error("다른 워커가 이미 실행 중입니다.");
  lock.on("error", (error) => {
    console.error("워커 잠금 연결 오류:", error.message);
    process.exit(1);
  });
  const graph = await createWorkflow(connectionString);
  await db.run.updateMany({
    where: { status: "RUNNING" },
    data: { status: "QUEUED" },
  });
  console.log("데모 워커 시작");
  while (true) {
    const next = await db.run.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const claimed = await db.run.updateMany({
      where: { id: next.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: next.startedAt ?? new Date() },
    });
    if (!claimed.count) continue;
    try {
      await processRun(graph, next.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류";
      await db.run.update({
        where: { id: next.id },
        data: {
          status: "FAILED",
          error: message.slice(0, 1000),
          finishedAt: new Date(),
        },
      });
      console.error(`실행 ${next.id} 실패:`, message);
    }
  }
}

main().catch((error) => {
  console.error("워커 시작 실패:", error.message);
  process.exit(1);
});
