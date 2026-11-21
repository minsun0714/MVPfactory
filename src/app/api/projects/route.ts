import { CeoLevel } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError, jsonRequest } from "@/lib/api";
import { db, DEV_USER_ID } from "@/lib/db";

export async function GET() {
  try {
    const projects = await db.project.findMany({
      where: { ownerId: DEV_USER_ID },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(projects);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  if (!jsonRequest(request)) return NextResponse.json({ error: "JSON 요청이 필요합니다." }, { status: 415 });
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const idea = typeof body.idea === "string" ? body.idea.trim() : "";
    if (!name || name.length > 100 || !idea || idea.length > 4000 || !Object.values(CeoLevel).includes(body.ceoLevel)) {
      return NextResponse.json({ error: "이름(100자 이내), 아이디어(4000자 이내), CEO 레벨을 확인하세요." }, { status: 400 });
    }
    if (body.mode && body.mode !== "DEMO") return NextResponse.json({ error: "실제 실행 모드는 연동이 구현되지 않았습니다." }, { status: 400 });
    const project = await db.$transaction(async (tx) => {
      await tx.user.upsert({ where: { id: DEV_USER_ID }, create: { id: DEV_USER_ID }, update: {} });
      return tx.project.create({
        data: { name, idea, requirements: idea, ceoLevel: body.ceoLevel, ownerId: DEV_USER_ID, runs: { create: { mode: "DEMO" } } },
        include: { runs: true },
      });
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) { return apiError(error); }
}
