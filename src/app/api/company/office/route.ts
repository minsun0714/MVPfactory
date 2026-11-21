import { getContainer } from "@/server/container";
import { handle, json, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

export const PUT = (request: Request) =>
  handle(async () =>
    json(
      await getContainer().company.updateOffice(await readJsonBody(request)),
    ),
  );
