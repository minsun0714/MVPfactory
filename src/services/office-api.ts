import { apiPaths } from "@/contracts/paths";
import type {
  CreateProjectRequest,
  Decision,
  DecisionResponseRequest,
  DecisionSummary,
  OfficeState,
  Page,
  Project,
  ProjectSummary,
} from "@/contracts";

export class OfficeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "OfficeApiError";
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Same-origin client for the new contracts; leaves legacy services untouched. */
export async function officeRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { Accept: "application/json", ...init.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = record(body) && record(body.error) ? body.error : null;
    throw new OfficeApiError(
      typeof error?.message === "string"
        ? error.message
        : "요청을 처리하지 못했습니다. 다시 시도해주세요.",
      response.status,
      typeof error?.code === "string" ? error.code : "UNKNOWN",
    );
  }
  if (!record(body))
    throw new OfficeApiError(
      "서버 응답 형식이 올바르지 않습니다.",
      response.status,
      "INVALID_RESPONSE",
    );
  return body as T;
}
export async function officeList<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page: Page<T> = await officeRequest(
      `${path}${path.includes("?") ? "&" : "?"}${query}`,
      { signal },
    );
    if (
      !Array.isArray(page.items) ||
      !(page.nextCursor === null || typeof page.nextCursor === "string")
    )
      throw new OfficeApiError(
        "목록 응답 형식이 올바르지 않습니다.",
        200,
        "INVALID_RESPONSE",
      );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor))
      throw new OfficeApiError(
        "목록을 끝까지 읽지 못했습니다.",
        200,
        "INVALID_CURSOR",
      );
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
export const officeApi = {
  projects: (signal?: AbortSignal) =>
    Promise.all([
      officeList<ProjectSummary>(`${apiPaths.projects}?archived=false`, signal),
      officeList<ProjectSummary>(`${apiPaths.projects}?archived=true`, signal),
    ]).then(([active, archived]) => [...active, ...archived]),
  decisions: (signal?: AbortSignal) =>
    officeList<DecisionSummary>(`${apiPaths.decisions}?status=OPEN`, signal),
  state: (id: string, signal?: AbortSignal) =>
    officeRequest<OfficeState>(apiPaths.officeState(id), { signal }),
  decision: (id: string, signal?: AbortSignal) =>
    officeRequest<Decision>(apiPaths.decision(id), { signal }),
  create: (body: CreateProjectRequest, key: string) =>
    officeRequest<Project>(apiPaths.projects, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  respond: (id: string, body: DecisionResponseRequest) =>
    officeRequest<Decision>(apiPaths.decisionResponse(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};
export function officeError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}
