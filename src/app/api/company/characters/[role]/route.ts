import { getContainer } from "@/server/container";
import { handle, json, readJsonBody } from "@/server/http";

export const runtime = "nodejs";

export const PUT = (
  request: Request,
  { params }: { params: Promise<{ role: string }> },
) =>
  handle(async () => {
    const { role } = await params;
    return json(
      await getContainer().company.updateCharacter(
        role,
        await readJsonBody(request),
      ),
    );
  });
