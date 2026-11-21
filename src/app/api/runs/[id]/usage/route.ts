import { getContainer } from "@/server/container";
import { handle, json, type IdParams } from "@/server/http";

export const runtime = "nodejs";

export const GET = (_request: Request, { params }: IdParams) =>
  handle(async () => json(await getContainer().runs.usage((await params).id)));
