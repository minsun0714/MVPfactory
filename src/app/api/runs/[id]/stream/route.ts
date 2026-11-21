import { SSE } from "@/contracts";
import { getContainer } from "@/server/container";
import { handle, type IdParams } from "@/server/http";
import { sseResponse } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Run 이벤트를 SSE로 전달한다. 접속하면 지정한 순번 이후의 저장된 이벤트를 먼저 보내고
 * 이후 새 이벤트를 실시간으로 보낸다. 연결이 끊겨도 실행에는 영향이 없다.
 */
export const GET = (request: Request, { params }: IdParams) =>
  handle(async () => {
    const { id } = await params;
    const url = new URL(request.url);
    const { events } = getContainer();
    // `?after`가 `Last-Event-ID`보다 우선한다.
    const after = await events.openStream(id, [
      url.searchParams.get("after"),
      request.headers.get("last-event-id"),
    ]);
    return sseResponse(
      request,
      (signal) => events.follow(id, after, signal),
      (item) =>
        item.kind === "event"
          ? `id: ${item.event.sequence}\nevent: ${SSE.runEventName}\ndata: ${JSON.stringify(item.event)}\n\n`
          : "",
    );
  });
