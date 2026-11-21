import { getContainer } from "@/server/container";
import { handle, json, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

export const GET = () =>
  handle(async () => json(await getContainer().settings.get()));

export const PUT = (request: Request) =>
  handle(async () =>
    json(await getContainer().settings.update(await readJsonBody(request))),
  );
