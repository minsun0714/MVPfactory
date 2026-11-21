import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { db, DEV_USER_ID } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await db.project.findFirst({
      where: { id, ownerId: DEV_USER_ID },
      include: { resources: true, runs: { orderBy: { createdAt: "desc" }, include: { artifacts: { orderBy: { createdAt: "asc" } }, decisions: { orderBy: { createdAt: "asc" } } } } },
    });
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json(project);
  } catch (error) { return apiError(error); }
}
