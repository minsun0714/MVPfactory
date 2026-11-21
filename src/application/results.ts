import type { ResultRepository } from "@/application/ports";
import { AppError } from "@/domain/errors";

export function createResultUseCases(results: ResultRepository) {
  return {
    async result(projectId: string) {
      const result = await results.result(projectId);
      if (!result)
        throw new AppError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      return result;
    },
    async verification(runId: string) {
      if (!(await results.runExists(runId)))
        throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
      const report = await results.verification(runId);
      if (!report)
        throw new AppError("NOT_FOUND", "아직 검증 결과가 없습니다.");
      return report;
    },
  };
}
