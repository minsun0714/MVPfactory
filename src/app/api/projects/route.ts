import { NextResponse } from "next/server";
import { apiError, readRequestJson } from "@/lib/api";
import { projects } from "@/server/projects";

export async function GET() {
  try {
    return NextResponse.json(await projects.list());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await projects.create(await readRequestJson(request)),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
