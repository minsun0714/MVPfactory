import { getContainer } from "@/server/container";
import { guardMutation, handle, type IdParams } from "@/server/http";

export const runtime = "nodejs";

export const POST = (request: Request, { params }: IdParams) =>
  handle(async () => {
    guardMutation(request);
    await getContainer().projects.unarchive((await params).id);
    return new Response(null, { status: 204 });
  });
