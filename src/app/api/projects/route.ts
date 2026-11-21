import { getContainer } from "@/server/container";
import { handle, idempotencyKeyOf, json, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

export const GET = (request: Request) =>
  handle(async () =>
    json(await getContainer().projects.list(new URL(request.url).searchParams)),
  );

export const POST = (request: Request) =>
  handle(async () =>
    json(
      await getContainer().projects.create(
        await readJsonBody(request),
        idempotencyKeyOf(request),
      ),
      201,
    ),
  );
