import { getContainer } from "@/server/container";
import { guardMutation, handle, json } from "@/server/http";

export const runtime = "nodejs";

export const POST = (
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) =>
  handle(async () => {
    guardMutation(request);
    const { provider } = await params;
    return json(await getContainer().settings.verify(provider));
  });
