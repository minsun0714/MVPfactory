/**
 * LangGraph로 실행 흐름(WORKFLOW.md §3)을 구성한다. 체크포인트는 PostgreSQL에 저장되어
 * 워커가 다시 시작되어도 같은 위치에서 이어갈 수 있다.
 *
 * 그래프의 노드는 얇다. 하는 일은 `WorkflowSteps`(애플리케이션 계층)가 하고,
 * 여기서는 순서·조건 간선·CEO 대기(interrupt)·재개만 다룬다.
 *
 * CEO 대기: `prepare_*`가 제안을 저장하고, `wait_*`가 interrupt를 만든다. interrupt가 저장된 것을
 * 확인한 뒤에만 결정을 열어(`OPEN`) CEO가 응답할 수 있게 한다. 재개하면 `wait_*`가 처음부터 다시 실행되므로
 * 그 앞에 부수 효과를 두지 않는다.
 */
import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { WorkflowStore } from "@/application/workflow-ports";
import type { AdvanceResult, WorkflowEngine } from "@/application/worker";
import {
  isPauseSignal,
  type WorkflowSteps,
} from "@/application/workflow-steps";
import type { ReviewKind } from "@/domain/workflow";

const State = Annotation.Root({ runId: Annotation<string>() });
type GraphState = typeof State.State;

const MAX_ROUNDS = 100;

export type GraphEngine = WorkflowEngine & { close(): Promise<void> };

export async function createGraphEngine(deps: {
  connectionString: string;
  steps: WorkflowSteps;
  store: WorkflowStore;
}): Promise<GraphEngine> {
  const { steps, store } = deps;
  const saver = PostgresSaver.fromConnString(deps.connectionString);
  await saver.setup();

  const runStep =
    (fn: (runId: string) => Promise<unknown>) => async (state: GraphState) => {
      await fn(state.runId);
      return {};
    };
  const waitForCeoResponse =
    (kind: ReviewKind) => async (state: GraphState) => {
      const decisionId = await steps.pendingDecisionId(state.runId, kind);
      interrupt({ decisionId });
      return {};
    };
  const routeAfterReview =
    (kind: ReviewKind, revise: string, next: string) =>
    async (state: GraphState) =>
      (await steps.needsRevision(state.runId, kind)) ? revise : next;

  const graph = new StateGraph(State)
    .addNode("intake", runStep(steps.intake))
    .addNode("plan", runStep(steps.plan))
    .addNode(
      "prepare_scope",
      runStep((id) => steps.prepareReview(id, "SCOPE_REVIEW")),
    )
    .addNode("wait_scope", waitForCeoResponse("SCOPE_REVIEW"))
    .addNode(
      "apply_scope",
      runStep((id) => steps.applyReview(id, "SCOPE_REVIEW")),
    )
    .addNode(
      "revise_scope",
      runStep((id) => steps.revise(id, "SCOPE_REVIEW")),
    )
    .addNode("design", runStep(steps.design))
    .addNode(
      "prepare_design",
      runStep((id) => steps.prepareReview(id, "DESIGN_REVIEW")),
    )
    .addNode("wait_design", waitForCeoResponse("DESIGN_REVIEW"))
    .addNode(
      "apply_design",
      runStep((id) => steps.applyReview(id, "DESIGN_REVIEW")),
    )
    .addNode(
      "revise_design",
      runStep((id) => steps.revise(id, "DESIGN_REVIEW")),
    )
    .addNode(
      "prepare_integrated",
      runStep((id) => steps.prepareReview(id, "INTEGRATED_REVIEW")),
    )
    .addNode("wait_integrated", waitForCeoResponse("INTEGRATED_REVIEW"))
    .addNode(
      "apply_integrated",
      runStep((id) => steps.applyReview(id, "INTEGRATED_REVIEW")),
    )
    .addNode(
      "revise_integrated",
      runStep((id) => steps.revise(id, "INTEGRATED_REVIEW")),
    )
    .addNode("freeze", runStep(steps.freeze))
    .addNode("implement", runStep(steps.implement))
    .addNode("finalize", runStep(steps.finalize))
    .addEdge(START, "intake")
    .addEdge("intake", "plan")
    .addConditionalEdges(
      "plan",
      async (state) =>
        (await steps.routeAfter(state.runId, "plan"))
          ? "prepare_scope"
          : "design",
      ["prepare_scope", "design"],
    )
    .addEdge("prepare_scope", "wait_scope")
    .addEdge("wait_scope", "apply_scope")
    .addConditionalEdges(
      "apply_scope",
      routeAfterReview("SCOPE_REVIEW", "revise_scope", "design"),
      ["revise_scope", "design"],
    )
    .addEdge("revise_scope", "prepare_scope")
    .addConditionalEdges(
      "design",
      async (state) => {
        const kind = await steps.routeAfter(state.runId, "design");
        return kind === "DESIGN_REVIEW"
          ? "prepare_design"
          : kind === "INTEGRATED_REVIEW"
            ? "prepare_integrated"
            : "freeze";
      },
      ["prepare_design", "prepare_integrated", "freeze"],
    )
    .addEdge("prepare_design", "wait_design")
    .addEdge("wait_design", "apply_design")
    .addConditionalEdges(
      "apply_design",
      routeAfterReview("DESIGN_REVIEW", "revise_design", "freeze"),
      ["revise_design", "freeze"],
    )
    .addEdge("revise_design", "prepare_design")
    .addEdge("prepare_integrated", "wait_integrated")
    .addEdge("wait_integrated", "apply_integrated")
    .addConditionalEdges(
      "apply_integrated",
      routeAfterReview("INTEGRATED_REVIEW", "revise_integrated", "freeze"),
      ["revise_integrated", "freeze"],
    )
    .addEdge("revise_integrated", "prepare_integrated")
    .addEdge("freeze", "implement")
    .addEdge("implement", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: saver });

  let closed = false;
  return {
    async advance(runId): Promise<AdvanceResult> {
      const snapshotOfRun = await store.loadRun(runId);
      if (!snapshotOfRun) throw new Error("실행을 찾을 수 없습니다.");
      const config = { configurable: { thread_id: snapshotOfRun.threadId } };

      /** 그래프를 한 번 진행한다. 정지 신호는 오류가 아니라 정상 종료로 취급한다. */
      async function invoke(
        input: Parameters<typeof graph.invoke>[0],
      ): Promise<"paused" | null> {
        try {
          await graph.invoke(input, config);
          return null;
        } catch (error) {
          if (isPauseSignal(error)) return "paused";
          throw error;
        }
      }

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const snapshot = await graph.getState(config);
        const pending = snapshot.tasks.flatMap(
          (task) => task.interrupts ?? [],
        )[0];
        const decisionId = (
          pending?.value as { decisionId?: string } | undefined
        )?.decisionId;

        if (decisionId) {
          const decision = await steps.decisionState(decisionId);
          if (!decision) throw new Error("대기 중인 결정을 찾을 수 없습니다.");
          if (decision.status === "PREPARED") {
            // interrupt가 저장된 것을 확인했으니 이제 CEO에게 연다.
            await store.openDecision(decisionId);
            return "waiting";
          }
          if (decision.status === "OPEN") {
            await store.ensureWaiting(runId);
            return "waiting";
          }
          if (decision.status !== "ANSWERED" && decision.status !== "APPLIED")
            throw new Error(
              `예상하지 못한 결정 상태입니다: ${decision.status}`,
            );
          if ((await invoke(new Command({ resume: true }))) === "paused")
            return "paused";
          continue;
        }

        if (snapshot.next.length === 0 && snapshot.values?.runId)
          return "finished";
        const input = snapshot.values?.runId ? null : { runId };
        if ((await invoke(input)) === "paused") return "paused";
      }
      throw new Error("워크플로우가 정해진 횟수 안에 끝나지 않았습니다.");
    },

    async close() {
      // 여러 곳에서 닫아도 한 번만 정리한다.
      if (closed) return;
      closed = true;
      await saver.end();
    },
  };
}
