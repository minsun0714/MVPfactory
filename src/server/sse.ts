import { SSE } from "@/contracts";

/** SSE 응답의 공통 부분. 연결이 끊기면 `items`에 넘긴 신호가 중단되어 정리된다. */
export function sseResponse<T extends { kind: "event" | "ping" }>(
  request: Request,
  items: (signal: AbortSignal) => AsyncIterable<T>,
  encodeEvent: (item: T) => string,
): Response {
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`retry: ${SSE.retryMs}\n\n`));
      try {
        for await (const item of items(abort.signal)) {
          const chunk =
            item.kind === "ping"
              ? `: ${SSE.heartbeatComment}\n\n`
              : encodeEvent(item);
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        // 연결 도중의 오류는 연결을 닫아 클라이언트가 이어받게 한다.
      } finally {
        try {
          controller.close();
        } catch {
          // 이미 닫힘
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
