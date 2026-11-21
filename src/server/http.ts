/**
 * Route Handler(Controller)가 공통으로 쓰는 요청·응답 처리.
 * 요청 파싱과 오류 변환만 하며 업무 판단은 유스케이스가 한다.
 */
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ERROR_HTTP_STATUS, HEADERS } from "@/contracts";
import type { ApiError, ErrorCode } from "@/contracts";
import { AppError } from "@/domain/errors";

function errorBody(
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: unknown,
) {
  return {
    error: { code, message, retryable, ...(details ? { details } : {}) },
  } as ApiError;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const known: AppError = error;
    return NextResponse.json(
      errorBody(known.code, known.message, known.retryable, known.details),
      { status: ERROR_HTTP_STATUS[known.code] },
    );
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P1001", "P1002", "P1017"].includes(error.code))
  )
    return NextResponse.json(
      errorBody(
        "SERVICE_UNAVAILABLE",
        "데이터베이스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
        true,
      ),
      { status: ERROR_HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  // 내부 오류의 원인은 서버 로그에만 남기고 사용자에게는 일반 문구만 돌려준다.
  console.error(
    "API 오류:",
    error instanceof Error ? error.message : "알 수 없는 오류",
  );
  return NextResponse.json(
    errorBody(
      "INTERNAL_ERROR",
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
      true,
    ),
    { status: ERROR_HTTP_STATUS.INTERNAL_ERROR },
  );
}

/** 핸들러에서 던진 오류를 계약된 오류 응답으로 바꾼다. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}

/** Next.js의 내부 URL 대신 실제 요청 Host를 기준으로 브라우저 출처를 검사한다. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let allowed = false;
  try {
    const source = new URL(origin);
    const internal = new URL(request.url);
    const host = request.headers.get("host") ?? internal.host;
    // Host는 authority만 허용한다. 전달 헤더는 신뢰할 프록시 설정 없이 사용하지 않는다.
    const target = new URL(`${internal.protocol}//${host}`);
    allowed =
      ["http:", "https:"].includes(source.protocol) &&
      source.origin === origin &&
      target.host === host &&
      !target.username &&
      !target.password &&
      source.origin === target.origin;
  } catch {
    // null·복수 출처·잘못된 URL은 거부한다.
  }
  if (!allowed)
    throw new AppError("FORBIDDEN_ORIGIN", "허용되지 않은 출처의 요청입니다.");
}

/** 변경 요청(POST, PUT, DELETE)의 공통 검사 */
export function guardMutation(request: Request): void {
  assertSameOrigin(request);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  guardMutation(request);
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "JSON 요청이 필요합니다.");
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "올바른 JSON 요청이 필요합니다.", {
      details: {
        fields: [{ field: "body", message: "올바른 JSON이어야 합니다." }],
      },
    });
  }
}

export function idempotencyKeyOf(request: Request): string | null {
  return request.headers.get(HEADERS.idempotencyKey);
}

export const noStore = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStore });
}

export type IdParams = { params: Promise<{ id: string }> };
