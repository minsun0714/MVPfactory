import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  console.error("API 오류:", error instanceof Error ? error.message : "알 수 없는 오류");
  return NextResponse.json({ error: "요청을 처리하지 못했습니다. DATABASE_URL과 DB 마이그레이션 상태를 확인하세요." }, { status: 500 });
}
export function jsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}
