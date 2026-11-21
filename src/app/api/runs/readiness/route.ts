import { NextResponse } from "next/server";
import { getContainer } from "@/server/container";
import { handle, noStore } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = () =>
  handle(async () =>
    NextResponse.json(await getContainer().runs.availability(), {
      headers: noStore,
    }),
  );
