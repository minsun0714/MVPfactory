/**
 * 문서 검토 → 담당 역할의 수정 → 연결 검사를 한도 안에서 반복한다.
 *
 * - 결정적 연결 규칙(`planProblems`·`designProblems`)과 검토 회의가 찾은 문제를 같은 방식으로 고친다.
 * - 대표가 이미 승인한 문서는 팀이 임의로 고치지 않고, 미해결 항목으로 이유와 함께 남긴다.
 * - 한도 안에 연결 규칙을 만족하지 못하면 개발로 넘기지 않고 실패한다(가짜 확정 금지).
 *
 * 모델·저장소를 모른다. 검토·수정·불러오기는 호출하는 쪽이 주입한다.
 */
import type { ReviewIssue } from "@/application/agents";
import {
  designProblems,
  planProblems,
  type DocumentTarget,
  type ProductPlanDocument,
  type ScreenDesignDocument,
} from "@/domain/product-documents";

export type ReviewedDocuments = {
  plan: ProductPlanDocument;
  design: ScreenDesignDocument | null;
};

export type DocumentReviewDeps = {
  /** 검토 회의 횟수 한도 */
  maxRounds: number;
  /** 대표가 승인해 팀이 고치지 않는 문서 */
  locked: DocumentTarget[];
  load(): Promise<ReviewedDocuments>;
  review(documents: ReviewedDocuments, round: number): Promise<ReviewIssue[]>;
  revise(target: DocumentTarget, changes: string[]): Promise<void>;
};

export type DocumentReviewOutcome = {
  rounds: number;
  /** 마지막 검토에서 고칠 점이 없었는지 */
  clean: boolean;
  revisions: { round: number; target: DocumentTarget; changes: string[] }[];
  unresolved: { issue: string; reason: string }[];
};

export class DocumentConsistencyError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `기획·화면 문서의 연결을 맞추지 못해 개발로 넘기지 않았어요. ${problems.join(" ")}`,
    );
    this.name = "DocumentConsistencyError";
  }
}

const TARGET_ORDER: DocumentTarget[] = ["PRODUCT_SPEC", "SCREEN_PLAN"];

function structuralIssues(documents: ReviewedDocuments): ReviewIssue[] {
  const problems = [
    ...planProblems(documents.plan),
    ...(documents.design
      ? designProblems(documents.plan, documents.design)
      : []),
  ];
  return problems.map((p) => ({
    target: p.target,
    problem: p.message,
    resolution: "문서 연결 규칙을 만족한다.",
  }));
}

const describe = (issue: ReviewIssue) =>
  `${issue.problem} (해결 조건: ${issue.resolution})`;

export async function reviewDocuments(
  deps: DocumentReviewDeps,
): Promise<DocumentReviewOutcome> {
  const revisions: DocumentReviewOutcome["revisions"] = [];
  const unresolved: DocumentReviewOutcome["unresolved"] = [];
  let unverified: ReviewIssue[] = [];

  /** 대상별로 한 번에 고친다. 기획을 먼저 고쳐 화면 수정이 바뀐 기획을 보게 한다. */
  async function apply(round: number, issues: ReviewIssue[]) {
    for (const target of TARGET_ORDER) {
      const mine = issues.filter((issue) => issue.target === target);
      if (mine.length === 0) continue;
      if (deps.locked.includes(target)) {
        for (const issue of mine)
          if (!unresolved.some((u) => u.issue === describe(issue)))
            unresolved.push({
              issue: describe(issue),
              reason: "대표님이 승인한 문서라 팀이 임의로 고치지 않았어요.",
            });
        continue;
      }
      const changes = mine.map(describe);
      await deps.revise(target, changes);
      revisions.push({ round, target, changes });
    }
  }

  for (let round = 1; round <= deps.maxRounds; round++) {
    const documents = await deps.load();
    const structural = structuralIssues(documents);
    const reviewed = await deps.review(documents, round);
    const issues = [...structural, ...reviewed];
    const fixable = issues.filter((i) => !deps.locked.includes(i.target));
    if (fixable.length === 0) {
      // 승인된 문서의 연결 오류는 팀이 고칠 수 없으므로 개발로 넘기지 않는다.
      if (structural.length)
        throw new DocumentConsistencyError(structural.map((i) => i.problem));
      await apply(round, issues);
      return {
        rounds: round,
        clean: issues.length === 0,
        revisions,
        unresolved,
      };
    }
    await apply(round, issues);
    // 연결 규칙은 마지막에 다시 확인하므로, 다시 확인하지 못할 수 있는 것은 회의가 찾은 문제뿐이다.
    unverified = reviewed.filter((i) => !deps.locked.includes(i.target));
  }

  // 마지막 수정 뒤에는 검토 회의를 더 열지 않는다. 연결 규칙만 확인하고, 어긋나면 한 번만 더 고친다.
  let remaining = structuralIssues(await deps.load());
  if (remaining.some((i) => !deps.locked.includes(i.target))) {
    await apply(deps.maxRounds + 1, remaining);
    remaining = structuralIssues(await deps.load());
  }
  if (remaining.length)
    throw new DocumentConsistencyError(remaining.map((i) => i.problem));

  for (const issue of unverified)
    unresolved.push({
      issue: describe(issue),
      reason: `고쳤지만 검토 회의 한도(${deps.maxRounds}회)로 다시 확인하지 못했어요.`,
    });
  return { rounds: deps.maxRounds, clean: false, revisions, unresolved };
}
