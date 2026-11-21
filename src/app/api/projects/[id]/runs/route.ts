import { getContainer } from "@/server/container";
import {
  handle,
  idempotencyKeyOf,
  json,
  readJsonBody,
  type IdParams,
} from "@/server/http";

export const runtime = "nodejs";

export const GET = (request: Request, { params }: IdParams) =>
  handle(async () =>
    json(
      await getContainer().runs.listByProject(
        (await params).id,
        new URL(request.url).searchParams,
      ),
    ),
  );

export const POST = (request: Request, { params }: IdParams) =>
  handle(async () => {
    const { id } = await params;
    const run = await getContainer().runs.start(
      id,
      await readJsonBody(request),
      idempotencyKeyOf(request),
    );
    return json(run, 202);
  });
