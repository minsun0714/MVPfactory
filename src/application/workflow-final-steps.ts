import type {
  RealExecution,
  WorkflowStepDependencies,
} from "@/application/workflow-steps";
import type { RoleId } from "@/contracts/common";
import { releaseSource } from "@/application/release";
import { dataPlanOf } from "@/domain/data-plan";
import { CONFIRMED_SPEC_KEYS } from "@/domain/product-documents";
import { DELEGATION_RATIONALE, internalMeeting } from "@/domain/demo-content";
import { STEPS } from "@/domain/workflow";

export function createWorkflowFinalSteps(
  deps: WorkflowStepDependencies & {
    configuredReal(runId: string): RealExecution | undefined;
    confirmedDocuments(runId: string): Promise<{
      specVersion: number;
      spec: Record<string, string>;
      screens: Record<string, string>;
    }>;
  },
) {
  const {
    store,
    guard,
    context,
    realOf,
    runMeeting,
    confirmedDocuments,
    configuredReal,
  } = deps;
  return {
    /** 검토가 끝나면(또는 위임형이면) 요구사항을 확정한다. 위임형은 CEO가 답한 것처럼 만들지 않는다. */
    async freeze(runId: string): Promise<void> {
      const run = await guard(runId);
      const step = STEPS.freeze;
      await store.beginStep(runId, step);
      if (run.ceoLevel === "DELEGATE") {
        const roles: RoleId[] = ["PM", "PLANNER", "DESIGNER", "DEVELOPER"];
        const internal = internalMeeting();
        const latest = await store.latestArtifacts(runId);
        const meetingId = await runMeeting(
          run,
          internal.topic,
          async () =>
            run.mode === "REAL"
              ? realOf(run).agents.meeting(
                  internal.topic,
                  await context(run),
                  Object.fromEntries(
                    Object.values(latest).map((a) => [a.type, a.content]),
                  ),
                  roles,
                )
              : internal,
          null,
          roles,
        );
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
          [CONFIRMED_SPEC_KEYS.plan]: artifacts.PRODUCT_SPEC?.content ?? {},
          [CONFIRMED_SPEC_KEYS.screens]: artifacts.SCREEN_PLAN?.content ?? {},
          ...(run.mode === "DEMO" ? { 데모: true } : {}),
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
      if (run.mode !== "DEMO") {
        const real = configuredReal(run.id);
        if (!real?.release)
          throw new Error(
            "GitHub 저장소 반영과 Vercel 배포가 아직 구현되지 않아 마무리할 수 없어요. 빌드·테스트까지만 확인했고 제품 완료로 보지 않아요.",
          );
        const snapshot = await store.latestSourceSnapshot(runId);
        if (!snapshot)
          throw new Error("검증을 통과한 소스가 없어 배포하지 않았어요.");
        const { specVersion, spec } = await confirmedDocuments(runId);
        const released = await releaseSource(
          { ...real.release, storage: real.storage },
          {
            projectId: run.projectId,
            runId,
            projectName: run.project.name,
            specVersion,
            snapshot,
            dataPlan: dataPlanOf(spec),
          },
        );
        await store.saveArtifact(runId, {
          author: "DEVELOPER",
          type: "RELEASE",
          title: "배포 결과",
          content: {
            저장소: released.repositoryUrl,
            커밋: released.commitSha,
            "운영 주소": released.finalUrl,
            "소스 식별자": snapshot.sourceDigest,
            안내: "배포와 접속은 확인했어요. 요구사항별 동작 검증은 아직 하지 않아 제품 완료로 보지 않아요.",
          },
        });
      }
      await store.succeedRun(runId);
    },
  };
}
