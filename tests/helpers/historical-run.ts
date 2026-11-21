/** Seed historical simulator records directly. Public APIs no longer accept DEMO. */
import { db } from "@/lib/db";
import { createRunRepository } from "@/infrastructure/prisma/run-repository";
import { parseStartRun, requireIdempotencyKey } from "@/domain/validation";
import { handle, json, type IdParams } from "@/server/http";
export const seedHistoricalRun = (request: Request, { params }: IdParams) =>
  handle(async () => {
    const run = await createRunRepository(db).start((await params).id, {
      key: requireIdempotencyKey(request.headers.get("idempotency-key")),
      request: parseStartRun(await request.json()),
    });
    return json(run, 202);
  });
/** Exercise the retained simulator repository, not the retired public demo controls. */
export const resumeHistoricalRun = (_request: Request, { params }: IdParams) =>
  handle(async () =>
    json(await createRunRepository(db).resume((await params).id)),
  );
export const retryHistoricalRun = (_request: Request, { params }: IdParams) =>
  handle(async () =>
    json(await createRunRepository(db).retry((await params).id)),
  );
