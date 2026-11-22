import type { AgentContext, ConfirmedDocuments } from "@/application/agents";
import type { LlmUsage } from "@/application/llm";
import { LimitReachedError } from "@/application/metered-model";
import type { WorkflowStore } from "@/application/workflow-ports";
import type { DataPlan } from "@/domain/data-plan";
import { reachedLimit } from "@/domain/limits";
import { documentFiles, withDocuments } from "@/domain/product-document-files";
import type { SourceFileInput } from "@/domain/sandbox";

/** Writes a complete source snapshot. Neither summaries nor JSON file lists count as source. */
export interface CodeWriter {
  write(input: {
    runId: string;
    context: AgentContext;
    /** 확정 사양. 생성과 자동 수정 모두 같은 확정본을 받는다. */
    spec: Record<string, string>;
    screens: Record<string, string>;
    /** 확정 사양에서 만든 문서 파일(docs/*.md). 읽기 전용 참고 자료다. */
    documents: SourceFileInput[];
    data: DataPlan | null;
    files: SourceFileInput[];
    evidence?: string;
    timeoutMs: number;
  }): Promise<{ files: SourceFileInput[]; usage: LlmUsage }>;
}

export function createSourceDeveloper(deps: {
  writer: CodeWriter;
  runId: string;
  store: Pick<WorkflowStore, "loadUsage" | "recordModelCall">;
}) {
  async function write(
    confirmed: ConfirmedDocuments,
    input: Omit<
      Parameters<CodeWriter["write"]>[0],
      "runId" | "timeoutMs" | "spec" | "screens" | "documents"
    >,
  ) {
    const documents = documentFiles(confirmed);
    const { limits, usage } = await deps.store.loadUsage(deps.runId);
    const reached = reachedLimit({ ...limits, maxFixAttempts: null }, usage);
    if (reached) throw new LimitReachedError(reached);
    const timeoutMs = Math.min(
      15 * 60_000,
      limits.maxActiveSeconds === null
        ? Infinity
        : (limits.maxActiveSeconds - usage.activeSeconds) * 1000,
    );
    let tokens: LlmUsage = { inputTokens: 0, outputTokens: 0 };
    try {
      const result = await deps.writer.write({
        ...input,
        spec: confirmed.spec,
        screens: confirmed.screens,
        documents,
        runId: deps.runId,
        timeoutMs,
      });
      tokens = result.usage;
      // 저장소의 문서는 개발자가 무엇을 썼든 확정본과 같게 둔다.
      return withDocuments(result.files, documents);
    } finally {
      // One CLI invocation is one developer turn; internal tool/model steps are not API calls we can count.
      // ChatGPT subscription usage has no API price: never apply LLM_API_KEY pricing to it.
      await deps.store.recordModelCall(deps.runId, {
        ...tokens,
        costUsd: null,
      });
    }
  }
  return {
    generateSource: (
      context: AgentContext,
      confirmed: ConfirmedDocuments,
      data: DataPlan | null = null,
    ) => write(confirmed, { context, data, files: [] }),
    fixSource: (
      context: AgentContext,
      files: SourceFileInput[],
      evidence: string,
      confirmed: ConfirmedDocuments,
      data: DataPlan | null = null,
    ) => write(confirmed, { context, files, evidence, data }),
  };
}

export type SourceDeveloper = ReturnType<typeof createSourceDeveloper>;
