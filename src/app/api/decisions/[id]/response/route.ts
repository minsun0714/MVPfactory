import { getContainer } from "@/server/container";
import { handle, json, readJsonBody, type IdParams } from "@/server/http";

export const runtime = "nodejs";

export const POST = (request: Request, { params }: IdParams) =>
  handle(async () => {
    const { id } = await params;
    return json(
      await getContainer().decisions.respond(id, await readJsonBody(request)),
    );
  });
