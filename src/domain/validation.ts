import {
  CEO_LEVELS,
  DECISION_CHOICES,
  DECISION_STATUSES,
  IDEMPOTENCY_KEY_LENGTH,
  INPUT_LIMITS,
  PAGE_LIMIT,
  RUN_MODES,
  RUN_TYPES,
} from "@/contracts";
import type {
  CeoLevel,
  CreateProjectRequest,
  DecisionChoice,
  DecisionListQuery,
  DecisionResponseRequest,
  ProjectListQuery,
  RunMode,
  RunType,
  ScopeCheckRequest,
  StartRunRequest,
} from "@/contracts";
import { AppError } from "@/domain/errors";

/** 필드별 오류를 모아 한 번에 `VALIDATION_FAILED`로 던진다. */
class FieldErrors {
  private readonly items: { field: string; message: string }[] = [];

  add(field: string, message: string) {
    this.items.push({ field, message });
  }

  throwIfAny(): void {
    if (this.items.length === 0) return;
    throw new AppError("VALIDATION_FAILED", "입력을 확인하세요.", {
      details: { fields: this.items },
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("VALIDATION_FAILED", "JSON 객체가 필요합니다.", {
      details: {
        fields: [{ field: "body", message: "JSON 객체가 필요합니다." }],
      },
    });
  return value as Record<string, unknown>;
}

function text(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
  options: { required: boolean; max: number },
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null) {
    if (options.required) errors.add(field, "필수 항목입니다.");
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.add(field, "문자열이어야 합니다.");
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    if (options.required) errors.add(field, "비워 둘 수 없습니다.");
    return undefined;
  }
  if (value.length > options.max) {
    errors.add(field, `${options.max}자 이내로 입력하세요.`);
    return undefined;
  }
  return value;
}

function oneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  errors: FieldErrors,
): T | undefined {
  const raw = body[field];
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw))
    return raw as T;
  errors.add(field, `다음 중 하나여야 합니다: ${allowed.join(", ")}`);
  return undefined;
}

export function parseCreateProject(value: unknown): CreateProjectRequest {
  const body = asRecord(value);
  const errors = new FieldErrors();
  const name = text(body, "name", errors, {
    required: true,
    max: INPUT_LIMITS.projectName,
  });
  const idea = text(body, "idea", errors, {
    required: true,
    max: INPUT_LIMITS.idea,
  });
  const purpose = text(body, "purpose", errors, {
    required: false,
    max: INPUT_LIMITS.purpose,
  });
  const constraints = text(body, "constraints", errors, {
    required: false,
    max: INPUT_LIMITS.constraints,
  });
  const ceoLevel = oneOf<CeoLevel>(body, "ceoLevel", CEO_LEVELS, errors);
  errors.throwIfAny();
  return {
    name: name!,
    idea: idea!,
    purpose,
    constraints,
    ceoLevel: ceoLevel!,
  };
}

export function parseScopeCheck(value: unknown): ScopeCheckRequest {
  const body = asRecord(value);
  const errors = new FieldErrors();
  const idea = text(body, "idea", errors, {
    required: true,
    max: INPUT_LIMITS.idea,
  });
  const purpose = text(body, "purpose", errors, {
    required: false,
    max: INPUT_LIMITS.purpose,
  });
  const constraints = text(body, "constraints", errors, {
    required: false,
    max: INPUT_LIMITS.constraints,
  });
  errors.throwIfAny();
  return { idea: idea!, purpose, constraints };
}

export function parseStartRun(value: unknown): StartRunRequest {
  const body = asRecord(value);
  const errors = new FieldErrors();
  const type = oneOf<RunType>(body, "type", RUN_TYPES, errors);
  const mode = oneOf<RunMode>(body, "mode", RUN_MODES, errors);
  const ceoLevel = oneOf<CeoLevel>(body, "ceoLevel", CEO_LEVELS, errors);
  const feedback = text(body, "feedback", errors, {
    required: type === "REVISION",
    max: INPUT_LIMITS.feedback,
  });
  if (
    type === "INITIAL" &&
    body.feedback !== undefined &&
    body.feedback !== null
  )
    errors.add("feedback", "최초 생성에는 피드백을 보낼 수 없습니다.");
  errors.throwIfAny();
  return { type: type!, mode: mode!, ceoLevel: ceoLevel!, feedback };
}

export function parseDecisionResponse(value: unknown): DecisionResponseRequest {
  const body = asRecord(value);
  const errors = new FieldErrors();
  const version = body.proposalVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    errors.add("proposalVersion", "1 이상의 정수여야 합니다.");
  const choice = oneOf<DecisionChoice>(
    body,
    "choice",
    DECISION_CHOICES,
    errors,
  );
  const optionId = text(body, "optionId", errors, {
    required: false,
    max: 100,
  });
  const comment = text(body, "comment", errors, {
    required: choice === "REQUEST_CHANGES",
    max: INPUT_LIMITS.decisionComment,
  });
  if (choice === "SELECT_OPTION" && !optionId)
    errors.add("optionId", "선택지를 지정하세요.");
  errors.throwIfAny();
  return {
    proposalVersion: version as number,
    choice: choice!,
    optionId,
    comment,
  };
}

/** 헤더 값에서 중복 방지 키를 읽는다. 변경 요청에는 필수다. */
export function requireIdempotencyKey(header: string | null): string {
  const key = header?.trim() ?? "";
  if (
    key.length < IDEMPOTENCY_KEY_LENGTH.min ||
    key.length > IDEMPOTENCY_KEY_LENGTH.max
  )
    throw new AppError(
      "VALIDATION_FAILED",
      "Idempotency-Key 헤더(8~64자)가 필요합니다.",
      {
        details: {
          fields: [{ field: "Idempotency-Key", message: "8~64자여야 합니다." }],
        },
      },
    );
  return key;
}

export type PageParams = { limit: number; cursor: string | null };

function readPage(params: URLSearchParams, errors: FieldErrors): PageParams {
  let limit: number = PAGE_LIMIT.default;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (
      !Number.isInteger(parsed) ||
      parsed < PAGE_LIMIT.min ||
      parsed > PAGE_LIMIT.max
    )
      errors.add(
        "limit",
        `${PAGE_LIMIT.min}~${PAGE_LIMIT.max} 사이의 정수여야 합니다.`,
      );
    else limit = parsed;
  }
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 200))
    errors.add("cursor", "올바르지 않은 커서입니다.");
  return { limit, cursor: cursor || null };
}

export function parsePageQuery(params: URLSearchParams): PageParams {
  const errors = new FieldErrors();
  const page = readPage(params, errors);
  errors.throwIfAny();
  return page;
}

export function parseProjectListQuery(
  params: URLSearchParams,
): PageParams & Required<Pick<ProjectListQuery, "archived">> {
  const errors = new FieldErrors();
  const page = readPage(params, errors);
  const raw = params.get("archived");
  if (raw !== null && raw !== "true" && raw !== "false")
    errors.add("archived", "true 또는 false여야 합니다.");
  errors.throwIfAny();
  return { ...page, archived: raw === "true" };
}

export function parseDecisionListQuery(
  params: URLSearchParams,
): PageParams & Pick<DecisionListQuery, "status" | "projectId"> {
  const errors = new FieldErrors();
  const page = readPage(params, errors);
  const rawStatus = params.get("status");
  let status: DecisionListQuery["status"];
  if (rawStatus !== null) {
    if ((DECISION_STATUSES as readonly string[]).includes(rawStatus))
      status = rawStatus as DecisionListQuery["status"];
    else
      errors.add(
        "status",
        `다음 중 하나여야 합니다: ${DECISION_STATUSES.join(", ")}`,
      );
  }
  errors.throwIfAny();
  return { ...page, status, projectId: params.get("projectId") ?? undefined };
}

/** SSE의 `Last-Event-ID` 또는 `after` 쿼리에서 이어받을 순번을 읽는다. 없으면 0. */
export function parseAfterSequence(...candidates: (string | null)[]): number {
  const raw = candidates.find((value) => value !== null && value !== "");
  if (raw === undefined || raw === null) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new AppError(
      "VALIDATION_FAILED",
      "after는 0 이상의 정수여야 합니다.",
      {
        details: {
          fields: [{ field: "after", message: "0 이상의 정수여야 합니다." }],
        },
      },
    );
  return value;
}

export function parseEventsLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200)
    throw new AppError(
      "VALIDATION_FAILED",
      "limit은 1~200 사이의 정수여야 합니다.",
      {
        details: {
          fields: [
            { field: "limit", message: "1~200 사이의 정수여야 합니다." },
          ],
        },
      },
    );
  return value;
}

import type {
  RepoVisibility,
  UpdateSettingsRequest,
} from "@/contracts/settings";
import type { RunLimits } from "@/contracts/runs";
import { PROVIDERS, REPO_VISIBILITIES } from "@/contracts/settings";
import type { Provider } from "@/contracts/settings";

export function parseProvider(value: string): Provider {
  if ((PROVIDERS as readonly string[]).includes(value))
    return value as Provider;
  throw new AppError("NOT_FOUND", "알 수 없는 공급자입니다.");
}

/** 한도 값은 0 이상의 수이고, null은 "미설정"이다. 횟수·초는 정수여야 한다. */
export function parseUpdateSettings(value: unknown): UpdateSettingsRequest {
  const body = asRecord(value);
  const errors = new FieldErrors();
  const result: UpdateSettingsRequest = {};
  if (body.repoVisibility !== undefined)
    result.repoVisibility = oneOf<RepoVisibility>(
      body,
      "repoVisibility",
      REPO_VISIBILITIES,
      errors,
    );
  if (body.limits !== undefined) {
    const limits = asRecord(body.limits);
    const parsed: Partial<RunLimits> = {};
    for (const [key, integer] of [
      ["maxModelCalls", true],
      ["maxFixAttempts", true],
      ["maxActiveSeconds", true],
      ["maxEstimatedCost", false],
    ] as const) {
      const raw = limits[key];
      if (raw === undefined) continue;
      if (raw === null) parsed[key] = null;
      else if (
        typeof raw === "number" &&
        Number.isFinite(raw) &&
        raw >= 0 &&
        (!integer || Number.isInteger(raw))
      )
        parsed[key] = raw;
      else
        errors.add(
          `limits.${key}`,
          integer
            ? "0 이상의 정수 또는 null이어야 합니다."
            : "0 이상의 수 또는 null이어야 합니다.",
        );
    }
    result.limits = parsed;
  }
  errors.throwIfAny();
  return result;
}
