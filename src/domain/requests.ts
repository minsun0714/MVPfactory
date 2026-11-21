export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export type CeoLevel = "DELEGATE" | "KEY_DECISIONS" | "COLLABORATIVE";
export type NewProject = { name: string; idea: string; ceoLevel: CeoLevel };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}

export function parseProject(value: unknown): NewProject {
  const body = record(value);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  const ceoLevel = body.ceoLevel;
  if (
    !name ||
    name.length > 100 ||
    !idea ||
    idea.length > 4000 ||
    (ceoLevel !== "DELEGATE" &&
      ceoLevel !== "KEY_DECISIONS" &&
      ceoLevel !== "COLLABORATIVE")
  )
    throw new RequestError(
      "이름(100자 이내), 아이디어(4000자 이내), CEO 레벨을 확인하세요.",
    );
  if (body.mode && body.mode !== "DEMO")
    throw new RequestError("실제 실행 모드는 연동이 구현되지 않았습니다.");
  return { name, idea, ceoLevel };
}

export function parseDecisionResponse(value: unknown): string {
  const body = record(value);
  const response =
    typeof body.response === "string" ? body.response.trim() : "";
  if (!response || response.length > 4000)
    throw new RequestError("응답을 1~4000자로 입력하세요.");
  return response;
}

export type DecisionOutcome = "accepted" | "missing" | "conflict";

export function decisionOutcome(
  decision: {
    status: string;
    response: string | null;
    runStatus: string;
  } | null,
  response: string,
): DecisionOutcome | "pending" {
  if (!decision) return "missing";
  if (decision.status === "ANSWERED")
    return decision.response === response ? "accepted" : "conflict";
  return decision.runStatus === "WAITING" ? "pending" : "conflict";
}
