import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "@/lib/api";
import { projects } from "@/server/projects";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(
      await projects.answer(id, await readRequestJson(request)),
    );
  } catch (error) {
    return apiError(error);
  }
}
