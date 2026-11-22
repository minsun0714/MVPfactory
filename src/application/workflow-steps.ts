/**
 * 워크플로우의 각 단계(노드)가 하는 일. 모델·그래프 엔진을 모르고, 저장 계약(`WorkflowStore`)과
 * 도메인 규칙만 사용한다. 그래프 엔진(`src/infrastructure/workflow`)이 이 단계들을 순서대로 호출한다.
 *
 * 모든 단계는 다시 실행해도 같은 결과가 나오도록(멱등) 만든다. 재시작·재개 때 같은 노드가 다시 실행될 수 있다.
 */
import type { RoleAgents } from "@/application/agents";
import type { SourceDeveloper } from "@/application/code-writer";
import type { BuildVerificationDeps } from "@/application/build-verification";
import { implementWithRealModel } from "@/application/real-implementation";
import { releaseSource, type ReleaseDeps } from "@/application/release";
import { dataPlanOf } from "@/domain/data-plan";
import {
  DocumentConsistencyError,
  reviewDocuments,
} from "@/application/document-review";
import {
  CONFIRMED_SPEC_KEYS,
  SPEC_PUBLIC_ACCESS,
  designProblems,
  planProblems,
  readConfirmedSpec,
  readDesign,
  readPlan,
  type DocumentTarget,
} from "@/domain/product-documents";
import { ARTIFACT_LIST_SEPARATOR } from "@/contracts/runs";
import type { SourceStorage } from "@/application/source-storage";
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

/** 실제 실행(REAL)에 필요한 것. Run마다 모델 사용량이 그 Run에 기록되도록 Run별로 만든다. */
export type RealExecution = {
  agents: Pick<
    RoleAgents,
    "intake" | "plan" | "design" | "meeting" | "reviewDocuments"
  >;
  developer: SourceDeveloper;
  verification: BuildVerificationDeps;
  storage: SourceStorage;
  /** GitHub 반영·Vercel 배포. 없으면 마무리 단계에서 멈춘다. */
  release?: Omit<ReleaseDeps, "storage">;
};

export type StepOptions = {
  /** 데모 진행을 화면에서 따라갈 수 있도록 단계 사이에 두는 지연(ms). 테스트는 0 */
  demoDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  /** REAL Run을 처리할 때만 쓴다. 없으면 REAL Run은 시작 단계에서 멈춘다(가짜 성공 금지). */
  real?: (runId: string) => RealExecution;
};

/** 문서 검토 회의 횟수 한도. 회의 1회는 모델 호출 1회와 담당 역할의 문서 수정(최대 2회)으로 이어진다. */
const DOCUMENT_REVIEW_ROUNDS = 2;
const TEAM: RoleId[] = ["PM", "PLANNER", "DESIGNER", "DEVELOPER"];
const NONE = "없음";

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

  function realOf(run: RunSnapshot): RealExecution {
    const real = options.real?.(run.id);
    if (!real) throw new Error("실제 실행 연동이 준비되지 않았습니다.");
    return real;
  }

  /** 주제는 미리 정해 두고 대화는 필요할 때만 만든다(이미 만든 회의는 모델을 다시 부르지 않는다). */
  async function runMeeting(
    run: RunSnapshot,
    topic: string,
    script: () => Promise<MeetingScript>,
    decisionId: string | null,
    participants: RoleId[],
  ) {
    const meeting = await store.startMeeting({
      runId: run.id,
      decisionId,
      topic,
      participants,
    });
    if (!meeting.created) return meeting.id;
    const { beats } = await script();
    let order = 0;
    for (const beat of beats) {
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

  /** 실제 모델이 산출물을 만드는 단계. 개발 단계는 소스를 만들고 샌드박스에서 검증한다. */
  async function realRoleStep(
    run: RunSnapshot,
    key: RoleStepKey,
    c: DemoContext,
  ): Promise<void> {
    const real = realOf(run);
    const step = STEPS[key];
    if (key === "implement") {
      // 작업 중인 산출물이 아니라 확정본으로만 개발한다(확정 뒤 산출물이 바뀌어도 승인한 버전을 지킨다).
      const { specVersion, spec, screens } = await confirmedDocuments(run.id);
      const plan = readPlan(spec);
      const design = readDesign(screens);
      if (plan && design) {
        const problems = [
          ...planProblems(plan),
          ...designProblems(plan, design),
        ];
        if (problems.length)
          throw new DocumentConsistencyError(problems.map((p) => p.message));
      }
      // DB가 필요한 앱인데 DB를 만들 수 없으면 모델 비용을 쓰기 전에 멈춘다(브라우저 저장으로 대신하지 않는다).
      if (dataPlanOf(spec) && !real.release?.supabase)
        throw new Error(
          "DB가 필요한 앱인데 Supabase 준비가 끝나지 않아 개발을 시작하지 않았어요. .env의 SUPABASE_PROJECT_REF와 공통 설정의 Supabase 연결을 확인하세요.",
        );
      const result = await implementWithRealModel(
        {
          store,
          agents: real.developer,
          verification: real.verification,
          storage: real.storage,
        },
        { runId: run.id, specVersion, context: c, spec, screens },
      );
      const artifact = await store.saveArtifact(run.id, {
        author: "DEVELOPER",
        type: "IMPLEMENTATION_RESULT",
        title: "개발 결과",
        content: {
          "소스 파일": `${result.files.length}개`,
          "소스 식별자": result.sourceDigest,
          "자동 수정": `${result.fixAttempts}번`,
          검증: result.items
            .map((item) => `${item.description}: ${item.result}`)
            .join(" · "),
        },
      });
      if (!result.passed) {
        const failed = result.items.find((item) => item.result === "FAIL");
        throw new Error(
          `빌드·테스트를 통과하지 못했어요(자동 수정 ${result.fixAttempts}번). ${failed?.description ?? ""}`.trim(),
        );
      }
      await store.completeStep(
        run.id,
        step,
        `소스를 만들고 빌드·테스트를 통과했어요. (자동 수정 ${result.fixAttempts}번) 배포는 아직 하지 않았어요.`,
        artifact.id,
      );
      return;
    }
    if (key === "intake") {
      const artifact = await store.saveArtifact(run.id, {
        author: "PM",
        type: "INTAKE_BRIEF",
        title: "범위 요약",
        content: await real.agents.intake(c),
      });
      await store.completeStep(run.id, step, "범위를 정리했어요.", artifact.id);
      return;
    }
    // 같은 Run에 이미 문서가 있으면(대표의 수정 요청·재시작) 처음부터 다시 쓰지 않고 그 문서를 고친다.
    let artifact =
      key === "plan"
        ? await writePlan(run, c, c.feedback)
        : await writeDesign(run, c, c.feedback);
    // 기획 직후에는 대표가 기능 범위를 검토할 때만 기획을 먼저 검토한다. 화면 설계 뒤에는 항상 두 문서를 함께 검토한다.
    const review =
      key === "design" || reviewsAfter(run.ceoLevel, "plan")
        ? await reviewStep(run, c, key)
        : null;
    if (review) artifact = review.artifact;
    const done =
      key === "plan"
        ? "기능과 완료 조건을 정리했어요."
        : "화면 구성을 정리했어요.";
    await store.completeStep(
      run.id,
      step,
      review?.unresolved
        ? `${done} 팀 검토에서 해결하지 못한 문제 ${review.unresolved}개를 남겼어요.`
        : done,
      artifact.id,
    );
  }

  /** 기획 문서를 쓰거나, 이미 있으면 `changes`에 맞춰 고친다. */
  async function writePlan(
    run: RunSnapshot,
    c: DemoContext,
    changes: string[],
  ) {
    const real = realOf(run);
    const latest = await store.latestArtifacts(run.id);
    const current = latest.PRODUCT_SPEC
      ? readPlan(latest.PRODUCT_SPEC.content)
      : null;
    const content = await real.agents.plan(
      c,
      latest.INTAKE_BRIEF?.content ?? {},
      // 수정 실행이면 이미 운영 중인 DB 계획을 알려 줘 추가만 하게 한다.
      (await real.release?.supabase?.store.current(run.projectId))?.plan ??
        null,
      current ? { document: current, changes } : null,
    );
    return store.saveArtifact(run.id, {
      author: "PLANNER",
      type: "PRODUCT_SPEC",
      title: "기획 결과",
      content,
    });
  }

  /** 화면 설계를 쓰거나, 이미 있으면 `changes`에 맞춰 고친다. 항상 최신 기획에 연결한다. */
  async function writeDesign(
    run: RunSnapshot,
    c: DemoContext,
    changes: string[],
  ) {
    const real = realOf(run);
    const latest = await store.latestArtifacts(run.id);
    const plan = latest.PRODUCT_SPEC
      ? readPlan(latest.PRODUCT_SPEC.content)
      : null;
    if (!plan)
      throw new Error("기획 문서를 읽을 수 없어 화면을 설계하지 않았어요.");
    const current = latest.SCREEN_PLAN
      ? readDesign(latest.SCREEN_PLAN.content)
      : null;
    const content = await real.agents.design(
      c,
      plan,
      current ? { document: current, changes } : null,
    );
    return store.saveArtifact(run.id, {
      author: "DESIGNER",
      type: "SCREEN_PLAN",
      title: "화면 구성",
      content,
    });
  }

  /**
   * 문서 검토 회의 → 담당 역할의 문서 수정 → 연결 검사. 결과는 회의 기록과 검토 결과 산출물로 남긴다.
   * 대표가 승인한 기능 범위는 팀이 바꾸지 않는다.
   */
  async function reviewStep(
    run: RunSnapshot,
    c: DemoContext,
    point: "plan" | "design",
  ) {
    const real = realOf(run);
    const locked: DocumentTarget[] =
      point === "design" &&
      (await store.latestAppliedChoice(run.id, "SCOPE_REVIEW")) === "APPROVE"
        ? ["PRODUCT_SPEC"]
        : [];
    let revisions = { plan: 0, design: 0 };
    const outcome = await reviewDocuments({
      maxRounds: DOCUMENT_REVIEW_ROUNDS,
      locked,
      async load() {
        const latest = await store.latestArtifacts(run.id);
        const plan = latest.PRODUCT_SPEC
          ? readPlan(latest.PRODUCT_SPEC.content)
          : null;
        const design =
          point === "design" && latest.SCREEN_PLAN
            ? readDesign(latest.SCREEN_PLAN.content)
            : null;
        if (!plan || (point === "design" && !design))
          throw new Error("검토할 문서의 구조를 읽을 수 없어요.");
        revisions = {
          plan: latest.PRODUCT_SPEC?.revision ?? 0,
          design: latest.SCREEN_PLAN?.revision ?? 0,
        };
        return { plan, design };
      },
      async review(documents) {
        // 같은 판(revision)의 문서는 같은 회의로 본다. 재시작해도 회의 기록이 중복되지 않는다.
        const topic =
          point === "plan"
            ? `기획 문서 검토 (기획 ${revisions.plan}판)`
            : `기획·화면 문서 검토 (기획 ${revisions.plan}판, 화면 ${revisions.design}판)`;
        const { script, issues } = await real.agents.reviewDocuments(
          topic,
          c,
          documents,
          TEAM,
        );
        const meetingId = await runMeeting(
          run,
          topic,
          async () => script,
          null,
          TEAM,
        );
        await store.endMeeting(
          meetingId,
          "DECIDED",
          issues.length
            ? `고칠 점 ${issues.length}개를 담당자에게 넘겼어요.`
            : "문서끼리 어긋난 곳이 없어요.",
        );
        return issues;
      },
      async revise(target, changes) {
        if (target === "PRODUCT_SPEC") await writePlan(run, c, changes);
        else await writeDesign(run, c, changes);
      },
    });
    await store.saveArtifact(run.id, {
      author: "PM",
      type: "DOCUMENT_REVIEW",
      title: point === "plan" ? "기획 문서 검토" : "기획·화면 문서 검토",
      content: {
        "검토 회의": `${outcome.rounds}회`,
        "고친 내용": outcome.revisions.length
          ? outcome.revisions
              .flatMap((r) =>
                r.changes.map(
                  (change) =>
                    `${r.target === "PRODUCT_SPEC" ? "기획" : "화면"}: ${change}`,
                ),
              )
              .join(ARTIFACT_LIST_SEPARATOR)
          : NONE,
        "남은 문제": outcome.unresolved.length
          ? outcome.unresolved
              .map((u) => `${u.issue} — ${u.reason}`)
              .join(ARTIFACT_LIST_SEPARATOR)
          : NONE,
      },
    });
    const latest = await store.latestArtifacts(run.id);
    const artifact =
      point === "plan" ? latest.PRODUCT_SPEC : latest.SCREEN_PLAN;
    if (!artifact) throw new Error("검토한 문서를 찾을 수 없어요.");
    return { artifact, unresolved: outcome.unresolved.length };
  }

  /** 이 Run의 확정 사양. 개발·배포는 이 확정본만 쓴다. */
  async function confirmedDocuments(runId: string) {
    const confirmed = await store.loadConfirmedSpec(runId);
    if (!confirmed)
      throw new Error("확정한 요구사항이 없어 개발을 시작할 수 없어요.");
    const documents = readConfirmedSpec(confirmed.content);
    if (!documents)
      throw new Error(
        "확정한 요구사항의 형식을 읽을 수 없어 개발하지 않았어요.",
      );
    return { specVersion: confirmed.version, ...documents };
  }

  /** 역할이 산출물 하나를 만드는 단계 */
  async function roleStep(runId: string, key: RoleStepKey): Promise<void> {
    const run = await guard(runId);
    const step = STEPS[key];
    const c = await context(run);
    await store.beginStep(runId, step);
    if (run.mode === "REAL") return realRoleStep(run, key, c);
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
        const real = options.real?.(run.id);
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
