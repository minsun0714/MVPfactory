import type { OfficeRepository } from "@/application/ports";
import { AppError } from "@/domain/errors";

export function createOfficeUseCases(office: OfficeRepository) {
  return {
    async state(projectId: string) {
      const state = await office.officeState(projectId);
      if (!state)
        throw new AppError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      return state;
    },
    async meetings(runId: string) {
      const items = await office.meetings(runId);
      if (!items) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
      return { items, nextCursor: null };
    },
    async meeting(id: string) {
      const meeting = await office.meeting(id);
      if (!meeting) throw new AppError("NOT_FOUND", "회의를 찾을 수 없습니다.");
      return meeting;
    },
  };
}
