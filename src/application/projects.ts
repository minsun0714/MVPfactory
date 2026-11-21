import type { ProjectRepository } from "@/application/ports";
import { AppError } from "@/domain/errors";
import { checkScope } from "@/domain/scope";
import {
  parseCreateProject,
  parseProjectListQuery,
  parseScopeCheck,
  requireIdempotencyKey,
} from "@/domain/validation";

export function createProjectUseCases(projects: ProjectRepository) {
  async function requireProject(id: string) {
    const project = await projects.find(id);
    if (!project)
      throw new AppError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
    return project;
  }

  return {
    create(body: unknown, idempotencyKey: string | null) {
      const request = parseCreateProject(body);
      return projects.create({
        key: requireIdempotencyKey(idempotencyKey),
        request,
      });
    },
    list: (params: URLSearchParams) =>
      projects.list(parseProjectListQuery(params)),
    get: requireProject,
    async archive(id: string) {
      await requireProject(id);
      await projects.setArchived(id, true);
    },
    async unarchive(id: string) {
      await requireProject(id);
      await projects.setArchived(id, false);
    },
    scopeCheck: (body: unknown) => checkScope(parseScopeCheck(body)),
  };
}
