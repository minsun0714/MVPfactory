import { getContainer } from "@/server/container";
import { guardMutation, handle, json, type IdParams } from "@/server/http";

export const runtime = "nodejs";

export const POST = (request: Request, { params }: IdParams) =>
  handle(async () => {
    guardMutation(request);
    return json(await getContainer().runs.retry((await params).id), 202);
  });
