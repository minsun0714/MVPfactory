import {
  parseProject,
  parseDecisionResponse,
  RequestError,
} from "@/domain/requests";
import type { NewProject, DecisionOutcome } from "@/domain/requests";

export interface ProjectRepository<List, Detail, Created> {
  list(ownerId: string): Promise<List>;
  find(id: string, ownerId: string): Promise<Detail | null>;
  create(input: NewProject, ownerId: string): Promise<Created>;
  answer(
    id: string,
    response: string,
    ownerId: string,
  ): Promise<DecisionOutcome>;
}

export function createProjectUseCases<List, Detail, Created>(
  repository: ProjectRepository<List, Detail, Created>,
  ownerId: string,
) {
  return {
    list: () => repository.list(ownerId),
    async find(id: string) {
      const project = await repository.find(id, ownerId);
      if (!project) throw new RequestError("프로젝트를 찾을 수 없습니다.", 404);
      return project;
    },
    create: (input: unknown) => repository.create(parseProject(input), ownerId),
    async answer(id: string, input: unknown) {
      const outcome = await repository.answer(
        id,
        parseDecisionResponse(input),
        ownerId,
      );
      if (outcome === "missing")
        throw new RequestError("결정을 찾을 수 없습니다.", 404);
      if (outcome === "conflict")
        throw new RequestError(
          "이미 응답되었거나 검토 대기 중이 아닙니다.",
          409,
        );
      return { ok: true };
    },
  };
}
