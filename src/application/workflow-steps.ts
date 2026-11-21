/**
 * 워크플로우의 각 단계(노드)가 하는 일. 모델·그래프 엔진을 모르고, 저장 계약(`WorkflowStore`)과
 * 도메인 규칙만 사용한다. 그래프 엔진(`src/infrastructure/workflow`)이 이 단계들을 순서대로 호출한다.
 *
 * 모든 단계는 다시 실행해도 같은 결과가 나오도록(멱등) 만든다. 재시작·재개 때 같은 노드가 다시 실행될 수 있다.
 */
import type {
  DecisionRecord,
  RunSnapshot,
  WorkflowStore,
} from "@/application/workflow-ports";
import type { RoleId } from "@/contracts/common";
import type { DecisionChoice } from "@/contracts/decisions";
import type { ArtifactAuthor } from "@/contracts/runs";
import {
  DELEGATION_RATIONALE,
  approvalOutcome,
  implementationPlan,
  internalMeeting,
  intakeBrief,
  productSpec,
  proposalFor,
  reviewMeeting,
  screenPlan,
  type DemoContext,
  type MeetingScript,
} from "@/domain/demo-content";
import {
  REVIEWS,
  STEPS,
  reviewsAfter,
  type ReviewKind,
  type RoleStepKey,
} from "@/domain/workflow";

/** 정지 요청을 안전한 지점(단계 사이)에서 반영해 그래프 실행을 멈추기 위한 신호 */
export class PauseSignal extends Error {
  constructor() {
    super("실행이 일시정지되었습니다.");
    this.name = "PauseSignal";
  }
}

export function isPauseSignal(error: unknown): boolean {
  return error instanceof Error && error.name === "PauseSignal";
}

export type StepOptions = {
  /** 데모 진행을 화면에서 따라갈 수 있도록 단계 사이에 두는 지연(ms). 테스트는 0 */
  demoDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createWorkflowSteps(
  store: WorkflowStore,
  options: StepOptions,
) {
  const sleep = options.sleep ?? defaultSleep;
  const pace = () =>
    options.demoDelayMs > 0 ? sleep(options.demoDelayMs) : Promise.resolve();

  async function load(runId: string): Promise<RunSnapshot> {
    const run = await store.loadRun(runId);
    if (!run) throw new Error("실행을 찾을 수 없습니다.");
    return run;
  }

  /** 단계를 시작하기 전에 정지 요청을 확인한다. 정지했다면 그래프 실행을 멈춘다. */
  async function guard(runId: string): Promise<RunSnapshot> {
    if (await store.pauseIfRequested(runId)) throw new PauseSignal();
    return load(runId);
  }

  async function context(run: RunSnapshot): Promise<DemoContext> {
    const feedback = await store.collectFeedback(run.id);
    return {
      projectName: run.project.name,
      idea: run.project.idea,
      purpose: run.project.purpose,
      constraints: run.project.constraints,
      feedback: run.feedback ? [run.feedback, ...feedback] : feedback,
    };
  }

  async function runMeeting(
    run: RunSnapshot,
    script: MeetingScript,
    decisionId: string | null,
    participants: RoleId[],
  ) {
    const meeting = await store.startMeeting({
      runId: run.id,
      decisionId,
      topic: script.topic,
      participants,
    });
    if (!meeting.created) return meeting.id;
    let order = 0;
    for (const beat of script.beats) {
      await pace();
      order += 1;
      await store.addMeetingEntry(
        meeting.id,
        beat.kind === "STATEMENT"
          ? { kind: "STATEMENT", order, role: beat.role, summary: beat.summary }
          : {
              kind: "REACTION",
              order,
              role: beat.role,
              reaction: beat.reaction,
            },
      );
    }
    return meeting.id;
  }

  /** 역할이 산출물 하나를 만드는 단계 */
  async function roleStep(runId: string, key: RoleStepKey): Promise<void> {
    const run = await guard(runId);
    const step = STEPS[key];
    const c = await context(run);
    await store.beginStep(runId, step);
    await pace();
    const made: Record<
      RoleStepKey,
      {
        author: ArtifactAuthor;
        type: string;
        title: string;
        content: Record<string, string>;
        done: string;
      }
    > = {
      intake: {
        author: "PM",
        type: "INTAKE_BRIEF",
        title: "범위 요약",
        content: intakeBrief(c),
        done: "범위를 정리했어요.",
      },
      plan: {
        author: "PLANNER",
        type: "PRODUCT_SPEC",
        title: "기획 결과",
        content: productSpec(c),
        done: "기능과 완료 조건을 정리했어요.",
      },
      design: {
        author: "DESIGNER",
        type: "SCREEN_PLAN",
        title: "화면 구성",
        content: screenPlan(c),
        done: "화면 구성을 정리했어요.",
      },
      implement: {
        author: "DEVELOPER",
        type: "IMPLEMENTATION_PLAN",
        title: "개발 계획(데모)",
        content: implementationPlan(c),
        done: "개발 계획을 정리했어요. 실제 코드는 만들지 않았어요.",
      },
    };
    const output = made[key];
    const artifact = await store.saveArtifact(runId, {
      author: output.author,
      type: output.type,
      title: output.title,
      content: output.content,
    });
    await store.completeStep(runId, step, output.done, artifact.id);
  }

  return {
    intake: (runId: string) => roleStep(runId, "intake"),
    plan: (runId: string) => roleStep(runId, "plan"),
    design: (runId: string) => roleStep(runId, "design"),
    implement: (runId: string) => roleStep(runId, "implement"),

    /** 검토 제안과 회의를 만든다. 아직 CEO에게 열지 않는다(대기 지점이 저장된 뒤에 연다). */
    async prepareReview(runId: string, kind: ReviewKind): Promise<void> {
      const run = await guard(runId);
      const def = REVIEWS[kind];
      const artifacts = await store.latestArtifacts(runId);
      const c = await context(run);
      const draft = proposalFor(
        kind,
        artifacts.PRODUCT_SPEC?.content ?? null,
        artifacts.SCREEN_PLAN?.content ?? null,
      );
      const changes = (await store.collectFeedback(runId, [kind])).map(
        (comment) => `대표님 수정 요청 반영: ${comment}`,
      );
      const decision = await store.prepareDecision(runId, kind, draft, changes);
      await runMeeting(
        run,
        reviewMeeting(kind, c),
        decision.id,
        def.participants,
      );
    },

    /** 대기 노드가 interrupt를 만들 대상 결정의 ID. 이 호출에는 부수 효과가 없다. */
    async pendingDecisionId(runId: string, kind: ReviewKind): Promise<string> {
      const decision = await store.findActiveDecision(runId, kind);
      if (!decision) throw new Error("검토할 결정을 찾을 수 없습니다.");
      return decision.id;
    },

    /** 응답을 사양에 반영한다. 반영한 결정은 다시 열지 않는다. */
    async applyReview(
      runId: string,
      kind: ReviewKind,
    ): Promise<DecisionChoice> {
      await guard(runId);
      const decision = await store.findActiveDecision(runId, kind);
      if (!decision) throw new Error("응답을 반영할 결정을 찾을 수 없습니다.");
      const result = await store.applyDecision(decision.id);
      await store.endMeetingOfDecision(
        decision.id,
        approvalOutcome(result.choice, result.comment),
      );
      return result.choice;
    },

    /** 수정 요청을 받은 검토 지점의 산출물을 다시 만든다. */
    async revise(runId: string, kind: ReviewKind): Promise<void> {
      for (const key of REVIEWS[kind].revise) await roleStep(runId, key);
    },

    /** 검토가 끝나면(또는 위임형이면) 요구사항을 확정한다. 위임형은 CEO가 답한 것처럼 만들지 않는다. */
    async freeze(runId: string): Promise<void> {
      const run = await guard(runId);
      const step = STEPS.freeze;
      await store.beginStep(runId, step);
      if (run.ceoLevel === "DELEGATE") {
        const meetingId = await runMeeting(run, internalMeeting(), null, [
          "PM",
          "PLANNER",
          "DESIGNER",
          "DEVELOPER",
        ]);
        await store.endMeeting(
          meetingId,
          "DECIDED",
          "위임 정책에 따라 팀이 확정했어요.",
        );
        await store.saveArtifact(runId, {
          author: "SYSTEM",
          type: "DELEGATION_RATIONALE",
          title: "위임 확정 근거",
          content: DELEGATION_RATIONALE,
        });
      }
      const artifacts = await store.latestArtifacts(runId);
      const version = await store.freezeSpec(runId, {
        summary:
          artifacts.PRODUCT_SPEC?.content["핵심 기능"] ?? run.project.idea,
        content: {
          기획: artifacts.PRODUCT_SPEC?.content ?? {},
          화면: artifacts.SCREEN_PLAN?.content ?? {},
          데모: true,
        },
      });
      await store.completeStep(
        runId,
        step,
        `요구사항을 확정했어요. (버전 ${version})`,
        null,
      );
    },

    async finalize(runId: string): Promise<void> {
      const run = await guard(runId);
      await store.beginStep(runId, STEPS.finalize);
      if (run.mode !== "DEMO")
        throw new Error("실제 실행 연동이 준비되지 않았습니다.");
      await store.succeedRun(runId);
    },

    // ── 경로 판단 (그래프의 조건 간선이 호출한다)
    async routeAfter(
      runId: string,
      point: "plan" | "design",
    ): Promise<ReviewKind | null> {
      const run = await load(runId);
      return reviewsAfter(run.ceoLevel, point);
    },

    /** 방금 반영한 응답이 수정 요청이면 다시 만들고 다시 검토한다. */
    async needsRevision(runId: string, kind: ReviewKind): Promise<boolean> {
      return (
        (await store.latestAppliedChoice(runId, kind)) === "REQUEST_CHANGES"
      );
    },

    decisionState: async (decisionId: string): Promise<DecisionRecord | null> =>
      store.findDecision(decisionId),
  };
}

export type WorkflowSteps = ReturnType<typeof createWorkflowSteps>;
