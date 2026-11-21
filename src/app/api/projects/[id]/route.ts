import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { projects } from "@/server/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await projects.find(id));
  } catch (error) {
    return apiError(error);
  }
}
