import { getContainer } from "@/server/container";
import { handle, json, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

export const POST = (request: Request) =>
  handle(async () =>
    json(getContainer().projects.scopeCheck(await readJsonBody(request))),
  );
