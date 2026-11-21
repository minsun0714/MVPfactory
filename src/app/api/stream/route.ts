import { SSE } from "@/contracts";
import { getContainer } from "@/server/container";
import { handle } from "@/server/http";
import { sseResponse } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 작업 공간 스트림. 모든 프로젝트의 결정·상태 변화를 요약해서 보낸다.
 * 접속한 뒤의 변화만 보내므로, 접속 직후에는 `GET /api/decisions`와 `GET /api/projects`로 현재 상태를 읽는다.
 */
export const GET = (request: Request) =>
  handle(async () => {
    const { events } = getContainer();
    return sseResponse(
      request,
      (signal) => events.followWorkspace(signal),
      (item) =>
        item.kind === "event"
          ? `event: ${SSE.workspaceEventName}\ndata: ${JSON.stringify(item.event)}\n\n`
          : "",
    );
  });
