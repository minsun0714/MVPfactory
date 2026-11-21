import type { IntegrationReadiness, RunRepository } from "@/application/ports";
import { AppError } from "@/domain/errors";
import { reachedLimit } from "@/domain/limits";
import {
  parsePageQuery,
  parseStartRun,
  requireIdempotencyKey,
} from "@/domain/validation";
import type { ExecutionReadiness } from "@/contracts/health";

export function createRunUseCases(
  runs: RunRepository,
  readiness: IntegrationReadiness,
) {
  async function availability(): Promise<ExecutionReadiness> {
    if (readiness.assess) {
      const { available, reason } = await readiness.assess();
      return {
        available,
        reason: available ? null : (reason ?? "실행 준비가 끝나지 않았어요."),
      };
    }
    const available = await readiness.isRealModeAvailable();
    return {
      available,
      reason: available
        ? null
        : "앱 생성·배포 연동이 아직 구현되지 않아 실행할 수 없어요. 프로젝트와 아이디어는 저장할 수 있어요.",
    };
  }
  async function requireRealExecution() {
    const state = await availability();
    if (!state.available)
      throw new AppError("INTEGRATION_NOT_CONFIGURED", state.reason!);
  }
  async function continueRun(id: string, action: "resume" | "retry") {
    const run = await runs.find(id);
    if (!run) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
    if (run.mode === "DEMO")
      throw new AppError(
        "INVALID_RUN_STATE",
        "종료된 데모 기능의 기록은 다시 실행할 수 없습니다.",
      );
    await requireRealExecution();
    // 한도에 이른 실행은 다시 진행하지 않는다. 현재 결과와 선택(한도 변경)을 남기고 멈춘다.
    const reached = reachedLimit(run.limits, run.usage);
    if (reached)
      throw new AppError(
        "LIMIT_REACHED",
        `${reached} 한도에 도달해서 더 진행하지 않아요. 한도를 늘리고 새 수정으로 시작하거나 현재 결과를 확인하세요.`,
      );
    return runs[action](id);
  }
  return {
    availability,
    async start(
      projectId: string,
      body: unknown,
      idempotencyKey: string | null,
    ) {
      const request = parseStartRun(body);
      const key = requireIdempotencyKey(idempotencyKey);
      if (request.mode !== "REAL")
        throw new AppError(
          "VALIDATION_FAILED",
          "데모 실행은 종료되었습니다. 실제 실행만 요청할 수 있습니다.",
          {
            details: {
              fields: [{ field: "mode", message: "REAL만 지원합니다." }],
            },
          },
        );
      await requireRealExecution();
      return runs.start(projectId, { key, request });
    },
    async get(id: string) {
      const run = await runs.find(id);
      if (!run) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
      return run;
    },
    pause: (id: string) => runs.pause(id),
    resume: (id: string) => continueRun(id, "resume"),
    retry: (id: string) => continueRun(id, "retry"),
    async artifacts(runId: string) {
      const items = await runs.listArtifacts(runId);
      if (!items) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
      return { items, nextCursor: null };
    },
    async artifact(id: string) {
      const artifact = await runs.findArtifact(id);
      if (!artifact)
        throw new AppError("NOT_FOUND", "산출물을 찾을 수 없습니다.");
      return artifact;
    },
    async usage(runId: string) {
      const run = await runs.find(runId);
      if (!run) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
      return { usage: run.usage, limits: run.limits };
    },
    async listByProject(projectId: string, params: URLSearchParams) {
      const page = await runs.listByProject(projectId, parsePageQuery(params));
      if (!page)
        throw new AppError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      return page;
    },
  };
}
