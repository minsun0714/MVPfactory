import type {
  RunEventRepository,
  RunEventSource,
  WorkspaceFeedRepository,
} from "@/application/ports";
import type { RunEvent, RunEventsPage, WorkspaceEvent } from "@/contracts";
import { SSE } from "@/contracts";
import { AppError } from "@/domain/errors";
import { parseAfterSequence, parseEventsLimit } from "@/domain/validation";

export type StreamItem = { kind: "event"; event: RunEvent } | { kind: "ping" };
export type WorkspaceStreamItem =
  { kind: "event"; event: WorkspaceEvent } | { kind: "ping" };

const CATCH_UP_PAGE = 200;

export function createEventUseCases(
  events: RunEventRepository,
  source: RunEventSource,
  feed: WorkspaceFeedRepository,
  options: { heartbeatMs?: number } = {},
) {
  const heartbeatMs = options.heartbeatMs ?? SSE.heartbeatMs;

  async function openWindow(runId: string, after: number) {
    const window = await events.window(runId);
    if (!window) throw new AppError("NOT_FOUND", "실행을 찾을 수 없습니다.");
    // 요청한 순번 다음 이벤트부터 보존되어 있어야 이어받을 수 있다.
    if (after + 1 < window.retainedFrom)
      throw new AppError(
        "EVENTS_EXPIRED",
        "요청한 순번의 이벤트가 보존 기간을 지났습니다. 현재 상태를 다시 조회하세요.",
      );
    return window;
  }

  return {
    /** 일반 조회. 새로고침 직후의 복원, SSE를 쓸 수 없는 환경, 테스트에 쓴다. */
    async list(runId: string, params: URLSearchParams): Promise<RunEventsPage> {
      const after = parseAfterSequence(params.get("after"));
      const limit = parseEventsLimit(params);
      const window = await openWindow(runId, after);
      const items = await events.listAfter(runId, after, limit);
      return { items, lastSequence: window.lastSequence };
    },

    /** 스트림을 열기 전에 검증한다. 문제가 있으면 여기서 오류를 던진다. */
    async openStream(runId: string, afterParams: (string | null)[]) {
      const after = parseAfterSequence(...afterParams);
      await openWindow(runId, after);
      return after;
    },

    /**
     * 저장된 이벤트를 순서대로 내보낸 뒤 새 이벤트를 기다린다.
     * 신호(`NOTIFY`)를 놓쳐도 하트비트 주기마다 DB를 다시 확인하므로 이벤트가 빠지지 않는다.
     */
    async *follow(
      runId: string,
      after: number,
      signal: AbortSignal,
    ): AsyncGenerator<StreamItem> {
      let cursor = after;
      let pending = true;
      let wake: (() => void) | null = null;
      const unsubscribe = source.subscribe((id) => {
        if (id === runId || id === "*") {
          pending = true;
          wake?.();
        }
      });

      const waitForSignal = () =>
        new Promise<"signal" | "timeout" | "abort">((resolve) => {
          const timer = setTimeout(() => finish("timeout"), heartbeatMs);
          const onAbort = () => finish("abort");
          const finish = (reason: "signal" | "timeout" | "abort") => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            wake = null;
            resolve(reason);
          };
          wake = () => finish("signal");
          signal.addEventListener("abort", onAbort, { once: true });
        });

      try {
        while (!signal.aborted) {
          if (pending) {
            pending = false;
            for (;;) {
              const page = await events.listAfter(runId, cursor, CATCH_UP_PAGE);
              for (const event of page) {
                yield { kind: "event", event };
                cursor = event.sequence;
              }
              if (page.length < CATCH_UP_PAGE) break;
            }
            continue;
          }
          const reason = await waitForSignal();
          if (reason === "abort") return;
          if (reason === "timeout") {
            yield { kind: "ping" };
            pending = true;
          }
        }
      } finally {
        unsubscribe();
      }
    },

    /**
     * 모든 프로젝트의 결정·상태 변화를 요약해서 내보낸다(알림·목록 갱신용).
     * 접속한 시점 이후의 변화만 보내며, 현재 상태는 목록 조회로 읽는다.
     * 접속 후 새로 생긴 Run은 처음부터 보낸다.
     */
    async *followWorkspace(
      signal: AbortSignal,
    ): AsyncGenerator<WorkspaceStreamItem> {
      let cursors = new Map<string, number>();
      const dirty = new Set<string>();
      let all = false;
      let wake: (() => void) | null = null;
      const unsubscribe = source.subscribe((id) => {
        if (id === "*") all = true;
        else dirty.add(id);
        wake?.();
      });

      const waitForSignal = () =>
        new Promise<"signal" | "timeout" | "abort">((resolve) => {
          const timer = setTimeout(() => finish("timeout"), heartbeatMs);
          const onAbort = () => finish("abort");
          const finish = (reason: "signal" | "timeout" | "abort") => {
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            wake = null;
            resolve(reason);
          };
          wake = () => finish("signal");
          signal.addEventListener("abort", onAbort, { once: true });
        });

      try {
        // 먼저 구독한 뒤 기준점을 읽는다. 읽는 동안 생긴 이벤트의 신호를 놓치지 않기 위해서다.
        cursors = await feed.snapshotCursors();
        while (!signal.aborted) {
          if (all) {
            // 연결이 끊겼다 복구됐다. 알고 있는 모든 Run을 다시 확인한다.
            all = false;
            for (const id of cursors.keys()) dirty.add(id);
          }
          if (dirty.size > 0) {
            const ids = [...dirty];
            dirty.clear();
            for (const runId of ids) {
              const change = await feed.changesAfter(
                runId,
                cursors.get(runId) ?? 0,
              );
              cursors.set(runId, change.lastSequence);
              for (const event of change.events) yield { kind: "event", event };
            }
            continue;
          }
          const reason = await waitForSignal();
          if (reason === "abort") return;
          if (reason === "timeout") {
            yield { kind: "ping" };
            for (const id of cursors.keys()) dirty.add(id);
          }
        }
      } finally {
        unsubscribe();
      }
    },
  };
}
