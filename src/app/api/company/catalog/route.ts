import { getContainer } from "@/server/container";
import { handle, json } from "@/server/http";

export const runtime = "nodejs";

export const GET = () =>
  handle(async () => json(getContainer().company.catalog()));
