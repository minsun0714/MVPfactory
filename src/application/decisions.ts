import type { DecisionRepository } from "@/application/ports";
import { AppError } from "@/domain/errors";
import {
  parseDecisionListQuery,
  parseDecisionResponse,
} from "@/domain/validation";

export function createDecisionUseCases(decisions: DecisionRepository) {
  return {
    list: (params: URLSearchParams) =>
      decisions.list(parseDecisionListQuery(params)),
    async get(id: string) {
      const decision = await decisions.find(id);
      if (!decision)
        throw new AppError("NOT_FOUND", "결정을 찾을 수 없습니다.");
      return decision;
    },
    respond: (id: string, body: unknown) =>
      decisions.respond(id, parseDecisionResponse(body)),
  };
}
