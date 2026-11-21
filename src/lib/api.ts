import { NextResponse } from "next/server";
import { RequestError } from "@/domain/requests";

export function apiError(error: unknown) {
  if (error instanceof RequestError || error instanceof HttpInputError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  console.error(
    "API 오류:",
    error instanceof Error ? error.message : "알 수 없는 오류",
  );
  return NextResponse.json(
    {
      error:
        "요청을 처리하지 못했습니다. DATABASE_URL과 DB 마이그레이션 상태를 확인하세요.",
    },
    { status: 500 },
  );
}
export function jsonRequest(request: Request) {
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() === "application/json"
  );
}

class HttpInputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function readRequestJson(request: Request): Promise<unknown> {
  if (!jsonRequest(request))
    throw new HttpInputError("JSON 요청이 필요합니다.", 415);
  try {
    return await request.json();
  } catch {
    throw new HttpInputError("올바른 JSON 요청이 필요합니다.", 400);
  }
}
