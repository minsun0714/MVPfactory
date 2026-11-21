import { NextResponse } from "next/server";
import { apiError, jsonRequest } from "@/lib/api";
import { db, DEV_USER_ID } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!jsonRequest(request))
    return NextResponse.json(
      { error: "JSON 요청이 필요합니다." },
      { status: 415 },
    );
  try {
    const { id } = await params;
    const body = await request.json();
    const response =
      typeof body.response === "string" ? body.response.trim() : "";
    if (!response || response.length > 4000)
      return NextResponse.json(
        { error: "응답을 1~4000자로 입력하세요." },
        { status: 400 },
      );
    const result = await db.$transaction(async (tx) => {
      const decision = await tx.decision.findFirst({
        where: { id, run: { project: { ownerId: DEV_USER_ID } } },
        include: { run: true },
      });
      if (!decision) return 404;
      if (decision.status === "ANSWERED")
        return decision.response === response ? 200 : 409;
      if (decision.run.status !== "WAITING") return 409;
      const updated = await tx.decision.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "ANSWERED", response, answeredAt: new Date() },
      });
      if (!updated.count) {
        const current = await tx.decision.findUniqueOrThrow({ where: { id } });
        return current.response === response ? 200 : 409;
      }
      await tx.run.update({
        where: { id: decision.runId },
        data: { status: "QUEUED", stage: "CEO 응답 접수" },
      });
      return 200;
    });
    return NextResponse.json(
      result === 200
        ? { ok: true }
        : {
            error:
              result === 404
                ? "결정을 찾을 수 없습니다."
                : "이미 응답되었거나 검토 대기 중이 아닙니다.",
          },
      { status: result },
    );
  } catch (error) {
    return apiError(error);
  }
}
