import type { WorkflowStepDependencies } from "@/application/workflow-steps";
import { ARTIFACT_LIST_SEPARATOR } from "@/contracts/runs";
import type { DecisionChoice } from "@/contracts/decisions";
import { SPEC_PUBLIC_ACCESS } from "@/domain/product-documents";
import {
  approvalOutcome,
  proposalFor,
  reviewMeeting,
} from "@/domain/demo-content";
import { REVIEWS, type ReviewKind, type RoleStepKey } from "@/domain/workflow";

export function createWorkflowReviewSteps(
  deps: WorkflowStepDependencies & {
    roleStep(runId: string, key: RoleStepKey): Promise<void>;
  },
) {
  const { store, guard, context, realOf, runMeeting, roleStep } = deps;
  const NONE = "없음";
  return {
    /** 검토 제안과 회의를 만든다. 아직 CEO에게 열지 않는다(대기 지점이 저장된 뒤에 연다). */
    async prepareReview(runId: string, kind: ReviewKind): Promise<void> {
      const run = await guard(runId);
      const def = REVIEWS[kind];
      const artifacts = await store.latestArtifacts(runId);
      const c = await context(run);
      const proposal = proposalFor(
        kind,
        artifacts.PRODUCT_SPEC?.content ?? null,
        artifacts.SCREEN_PLAN?.content ?? null,
      );
      // 데이터 공개 범위와 팀 검토에서 해결하지 못한 문제는 대표가 결정할 때 함께 보여 준다.
      const publicAccess = artifacts.PRODUCT_SPEC?.content[SPEC_PUBLIC_ACCESS];
      const unresolved = artifacts.DOCUMENT_REVIEW?.content["남은 문제"];
      const draft = {
        ...proposal,
        proposal: [
          ...proposal.proposal,
          ...(publicAccess
            ? [{ heading: "데이터 공개 범위", items: [publicAccess] }]
            : []),
          ...(unresolved && unresolved !== NONE
            ? [
                {
                  heading: "팀 검토에서 남은 문제",
                  items: unresolved.split(ARTIFACT_LIST_SEPARATOR),
                },
              ]
            : []),
        ],
      };
      const changes = (await store.collectFeedback(runId, [kind])).map(
        (comment) => `대표님 수정 요청 반영: ${comment}`,
      );
      const decision = await store.prepareDecision(runId, kind, draft, changes);
      const demo = reviewMeeting(kind, c);
      await runMeeting(
        run,
        demo.topic,
        async () =>
          run.mode === "REAL"
            ? realOf(run).agents.meeting(
                demo.topic,
                c,
                Object.fromEntries(
                  Object.values(artifacts).map((a) => [a.type, a.content]),
                ),
                def.participants,
              )
            : demo,
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
  };
}
