import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ReviewIssue } from "@/application/agents";
import {
  DocumentConsistencyError,
  reviewDocuments,
  type ReviewedDocuments,
} from "@/application/document-review";
import type {
  DocumentTarget,
  ProductPlanDocument,
  ScreenDesignDocument,
} from "@/domain/product-documents";

const PLAN: ProductPlanDocument = {
  purpose: "독서 기록",
  inScope: ["기록"],
  outOfScope: [],
  requirements: [
    { id: "APP-REQ-001", name: "기록 추가", flow: ["저장"], dataUses: [] },
    { id: "APP-REQ-002", name: "목록 보기", flow: ["열기"], dataUses: [] },
  ],
  criteria: [
    { id: "APP-AC-001", requirementId: "APP-REQ-001", statement: "a" },
    { id: "APP-AC-002", requirementId: "APP-REQ-002", statement: "b" },
    { id: "APP-AC-003", requirementId: "APP-REQ-002", statement: "c" },
  ],
  data: { description: "제목", plan: null },
};
const screen = (requirementIds: string[]): ScreenDesignDocument => ({
  brief: {
    mode: "Operate",
    audience: "카페 쿠폰을 모으는 사람",
    outcome: "만료 전에 쓸 쿠폰을 찾는다",
    direction: "차분한 중립색, 만료 임박만 강조",
    layout: "목록 위 추가 버튼, 모바일 한 열",
    antiGoals: ["장식용 애니메이션"],
    assumptions: ["쿠폰은 수십 개 이하"],
  },
  guide: null,
  screens: [
    {
      id: "SCR-001",
      name: "목록",
      requirementIds,
      primaryAction: "추가",
      actions: ["추가"],
      states: {
        normal: "목록",
        empty: "비어 있음",
        loading: "불러오는 중",
        error: "오류",
      },
    },
  ],
  navigation: "한 화면",
});
const ISSUE: ReviewIssue = {
  target: "PRODUCT_SPEC",
  problem: "정렬 기준 없음",
  resolution: "정렬 기준 명시",
};

/** 문서·검토·수정을 기록하는 가짜 의존성 */
function harness(opts: {
  design?: ScreenDesignDocument | null;
  reviews: ReviewIssue[][];
  locked?: DocumentTarget[];
  onRevise?: (target: DocumentTarget, docs: ReviewedDocuments) => void;
}) {
  const docs: ReviewedDocuments = {
    plan: PLAN,
    design:
      opts.design === undefined
        ? screen(["APP-REQ-001", "APP-REQ-002"])
        : opts.design,
  };
  const calls = {
    review: 0,
    revise: [] as { target: DocumentTarget; changes: string[] }[],
  };
  return {
    calls,
    deps: {
      maxRounds: 2,
      locked: opts.locked ?? [],
      load: async () => structuredClone(docs),
      review: async () => opts.reviews[calls.review++] ?? [],
      revise: async (target: DocumentTarget, changes: string[]) => {
        calls.revise.push({ target, changes });
        opts.onRevise?.(target, docs);
      },
    },
  };
}

test("검토에서 문제가 없으면 한 번으로 끝내고 아무것도 고치지 않는다", async () => {
  const { deps, calls } = harness({ reviews: [[]] });
  const outcome = await reviewDocuments(deps);
  assert.deepEqual(outcome, {
    rounds: 1,
    clean: true,
    revisions: [],
    unresolved: [],
  });
  assert.equal(calls.review, 1);
});

test("회의가 찾은 문제를 담당 문서에 넘겨 고치고, 다음 회의에서 확인한다", async () => {
  const { deps, calls } = harness({ reviews: [[ISSUE], []] });
  const outcome = await reviewDocuments(deps);
  assert.equal(outcome.rounds, 2);
  assert.equal(outcome.clean, true);
  assert.deepEqual(calls.revise, [
    {
      target: "PRODUCT_SPEC",
      changes: ["정렬 기준 없음 (해결 조건: 정렬 기준 명시)"],
    },
  ]);
});

test("연결 규칙 위반은 회의 결과와 관계없이 화면 담당에게 넘긴다", async () => {
  const { deps, calls } = harness({
    design: screen(["APP-REQ-001"]),
    reviews: [[], []],
    onRevise: (target, docs) => {
      if (target === "SCREEN_PLAN")
        docs.design = screen(["APP-REQ-001", "APP-REQ-002"]);
    },
  });
  const outcome = await reviewDocuments(deps);
  assert.equal(outcome.clean, true);
  assert.equal(calls.revise[0].target, "SCREEN_PLAN");
  assert.match(
    calls.revise[0].changes[0],
    /다루는 화면이 없는 기능: APP-REQ-002/,
  );
});

test("대표가 승인한 기획은 팀이 고치지 않고 이유와 함께 남긴다", async () => {
  const { deps, calls } = harness({
    reviews: [[ISSUE]],
    locked: ["PRODUCT_SPEC"],
  });
  const outcome = await reviewDocuments(deps);
  assert.deepEqual(calls.revise, []);
  assert.deepEqual(outcome.unresolved, [
    {
      issue: "정렬 기준 없음 (해결 조건: 정렬 기준 명시)",
      reason: "대표님이 승인한 문서라 팀이 임의로 고치지 않았어요.",
    },
  ]);
});

test("한도까지 고쳐도 회의가 계속 문제를 찾으면 확인하지 못한 수정으로 남긴다", async () => {
  const { deps, calls } = harness({ reviews: [[ISSUE], [ISSUE], [ISSUE]] });
  const outcome = await reviewDocuments(deps);
  assert.equal(calls.review, 2, "회의는 한도만큼만 연다");
  assert.equal(calls.revise.length, 2);
  assert.equal(outcome.clean, false);
  assert.match(outcome.unresolved[0].reason, /검토 회의 한도\(2회\)/);
});

test("한도 안에 연결 규칙을 맞추지 못하면 개발로 넘기지 않고 실패한다", async () => {
  const { deps } = harness({ design: screen(["APP-REQ-001"]), reviews: [] });
  await assert.rejects(
    reviewDocuments(deps),
    (e: unknown) =>
      e instanceof DocumentConsistencyError &&
      /다루는 화면이 없는 기능: APP-REQ-002/.test(e.message),
  );
});
