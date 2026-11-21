import { NextResponse } from "next/server";
import { getContainer } from "@/server/container";
import { handle, noStore } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DB가 내려가 있으면 503과 함께 같은 본문을 돌려준다. 연결 정보나 내부 오류는 담지 않는다. */
export const GET = () =>
  handle(async () => {
    const health = await getContainer().health.check();
    return NextResponse.json(health, {
      status: health.database === "OK" ? 200 : 503,
      headers: noStore,
    });
  });
