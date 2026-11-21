import { getContainer } from "@/server/container";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";

export const GET = (request: Request) =>
  handle(async () =>
    json(
      await getContainer().decisions.list(new URL(request.url).searchParams),
    ),
  );
