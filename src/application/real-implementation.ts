/**
 * 개발자 에이전트가 소스를 만들고, 샌드박스에서 빌드·테스트하며, 실패하면 한도 안에서 고치는 단계.
 *
 * - 합격 여부는 샌드박스에서 실제로 실행한 결과로만 정한다(에이전트의 말은 근거가 아니다).
 * - 고치는 횟수는 Run 한도(`maxFixAttempts`)를 넘지 않는다. 한도 판단은 `reachedLimit` 하나만 쓴다.
 * - 합격한 소스는 샌드박스 밖(`SourceStorage`)에 보존하고 검증 보고서와 같은 소스 식별자로 묶는다.
 */
import type { AgentContext } from "@/application/agents";
import type { SourceDeveloper } from "@/application/code-writer";
import {
  resolveLockfile,
  verifyBuild,
  LockfileError,
  type BuildVerificationDeps,
  type VerificationItemDraft,
} from "@/application/build-verification";
import { LimitReachedError } from "@/application/metered-model";
import type { SourceStorage } from "@/application/source-storage";
import type { WorkflowStore } from "@/application/workflow-ports";
import { dataPlanOf } from "@/domain/data-plan";
import { reachedLimit } from "@/domain/limits";
import { computeSourceDigest, type SourceFileInput } from "@/domain/sandbox";
import { CHECK_BUILD, CHECK_TESTS } from "@/domain/results";

export type RealImplementationDeps = {
  store: Pick<
    WorkflowStore,
    "loadUsage" | "recordFixAttempt" | "saveSourceSnapshot"
  >;
  agents: SourceDeveloper;
  verification: BuildVerificationDeps;
  storage: SourceStorage;
};

export type RealImplementationResult = {
  passed: boolean;
  fixAttempts: number;
  files: SourceFileInput[];
  sourceDigest: string;
  reportId: string;
  items: VerificationItemDraft[];
};

const passes = (items: VerificationItemDraft[]) =>
  [CHECK_BUILD, CHECK_TESTS].every((id) =>
    items.some((item) => item.checkId === id && item.result === "PASS"),
  );

/** 고칠 수 있는 실패인지: 비밀값·소스 규칙 위반은 모델이 고칠 대상이 아니라 즉시 멈춘다. */
const fixable = (items: VerificationItemDraft[]) =>
  items.some(
    (item) =>
      (item.checkId === CHECK_BUILD || item.checkId === CHECK_TESTS) &&
      item.result === "FAIL",
  );

export async function implementWithRealModel(
  deps: RealImplementationDeps,
  input: {
    runId: string;
    specVersion: number;
    context: AgentContext;
    spec: Record<string, string>;
    screens: Record<string, string>;
  },
): Promise<RealImplementationResult> {
  const { store, agents, verification, storage } = deps;
  const redact = verification.redact;
  // 사양의 데이터 계획. 있으면 개발자는 Supabase로 저장하는 코드를 만든다.
  const data = dataPlanOf(input.spec);
  const lock = (files: SourceFileInput[]) =>
    resolveLockfile(verification.sandbox, input.runId, files, { redact });

  const confirmed = {
    specVersion: input.specVersion,
    spec: input.spec,
    screens: input.screens,
  };
  let files = await lock(
    await agents.generateSource(input.context, confirmed, data),
  );
  let fixAttempts = 0;

  for (;;) {
    const outcome = await verifyBuild(verification, {
      runId: input.runId,
      specVersion: input.specVersion,
      files,
    });
    if (passes(outcome.items)) {
      const lockfile = files.find((file) => file.path === "package-lock.json");
      const storageRef = await storage.put(
        input.runId,
        outcome.sourceDigest,
        files,
      );
      await store.saveSourceSnapshot(input.runId, {
        sourceDigest: outcome.sourceDigest,
        lockfileDigest: lockfile ? computeSourceDigest([lockfile]) : null,
        fileCount: files.length,
        storageRef,
      });
      return {
        passed: true,
        fixAttempts,
        files,
        sourceDigest: outcome.sourceDigest,
        reportId: outcome.reportId,
        items: outcome.items,
      };
    }

    const { limits, usage } = await store.loadUsage(input.runId);
    const stopped =
      !fixable(outcome.items) ||
      (limits.maxFixAttempts !== null &&
        usage.fixAttempts >= limits.maxFixAttempts) ||
      reachedLimit({ ...limits, maxFixAttempts: null }, usage) !== null;
    if (stopped) {
      return {
        passed: false,
        fixAttempts,
        files,
        sourceDigest: outcome.sourceDigest,
        reportId: outcome.reportId,
        items: outcome.items,
      };
    }

    const failed = outcome.items.find(
      (item) =>
        item.result === "FAIL" &&
        (item.checkId === CHECK_BUILD || item.checkId === CHECK_TESTS),
    )!;
    await store.recordFixAttempt(input.runId);
    fixAttempts += 1;
    const changed = await agents.fixSource(
      input.context,
      files,
      failed.evidence ?? failed.description,
      confirmed,
      data,
    );
    // Codex returns a full filesystem snapshot, including intentional deletions.
    try {
      files = await lock(changed);
    } catch (error) {
      if (!(error instanceof LockfileError)) throw error;
      // 의존성을 해석하지 못하면 이번 수정은 실패로 보고 같은 소스로 다음 판단을 한다.
      files = changed;
    }
  }
}

export { LimitReachedError };
