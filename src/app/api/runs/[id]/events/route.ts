import { getContainer } from "@/server/container";
import { handle, json, type IdParams } from "@/server/http";

export const runtime = "nodejs";

export const GET = (request: Request, { params }: IdParams) =>
  handle(async () =>
    json(
      await getContainer().events.list(
        (await params).id,
        new URL(request.url).searchParams,
      ),
    ),
  );
