import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppError } from "@/domain/errors";
import {
  evaluateDecisionResponse,
  type DecisionState,
} from "@/domain/decisions";
import {
  assertCanStartRun,
  decidePause,
  decideResume,
  decideRetry,
} from "@/domain/runs";
import { checkScope } from "@/domain/scope";
import {
  internalMeeting,
  reviewMeeting,
  type DemoContext,
} from "@/domain/demo-content";
import { REVIEWS, type ReviewKind } from "@/domain/workflow";
import {
  parseAfterSequence,
  parseCreateProject,
  parseDecisionResponse,
  parseStartRun,
  requireIdempotencyKey,
} from "@/domain/validation";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return "NO_ERROR";
}

const open: DecisionState = {
  kind: "INTEGRATED_REVIEW",
  status: "OPEN",
  proposalVersion: 2,
  optionIds: [],
  response: null,
};
const waiting = { status: "WAITING_CEO", pauseRequested: false } as const;
const approve = { proposalVersion: 2, choice: "APPROVE" } as const;

test("프로젝트 생성 입력을 검증하고 공백을 정리한다", () => {
  const parsed = parseCreateProject({
    name: "  공부 기록  ",
    idea: "날짜, 제목, 메모를 기록",
    purpose: "   ",
    ceoLevel: "KEY_DECISIONS",
  });
  assert.equal(parsed.name, "공부 기록");
  assert.equal(parsed.purpose, undefined);
  assert.equal(
    codeOf(() => parseCreateProject({ name: "", idea: "x", ceoLevel: "X" })),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() => parseCreateProject("문자열")),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() =>
      parseCreateProject({
        name: "a".repeat(101),
        idea: "x",
        ceoLevel: "DELEGATE",
      }),
    ),
    "VALIDATION_FAILED",
  );
});

test("실행 시작 입력: 수정에는 피드백이 필요하고 최초 생성에는 보낼 수 없다", () => {
  const base = { mode: "DEMO", ceoLevel: "DELEGATE" };
  assert.equal(parseStartRun({ ...base, type: "INITIAL" }).feedback, undefined);
  assert.equal(
    codeOf(() => parseStartRun({ ...base, type: "REVISION" })),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() => parseStartRun({ ...base, type: "INITIAL", feedback: "x" })),
    "VALIDATION_FAILED",
  );
  assert.equal(
    parseStartRun({ ...base, type: "REVISION", feedback: "시간 추가" })
      .feedback,
    "시간 추가",
  );
});

test("결정 응답 입력: 수정 요청에는 의견, 선택에는 선택지가 필요하다", () => {
  assert.equal(
    codeOf(() =>
      parseDecisionResponse({ proposalVersion: 1, choice: "REQUEST_CHANGES" }),
    ),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() =>
      parseDecisionResponse({ proposalVersion: 1, choice: "SELECT_OPTION" }),
    ),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() =>
      parseDecisionResponse({ proposalVersion: 0, choice: "APPROVE" }),
    ),
    "VALIDATION_FAILED",
  );
  assert.equal(
    parseDecisionResponse({ proposalVersion: 1, choice: "APPROVE" }).choice,
    "APPROVE",
  );
});

test("중복 방지 키와 이어받기 순번 검증", () => {
  assert.equal(
    codeOf(() => requireIdempotencyKey(null)),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() => requireIdempotencyKey("short")),
    "VALIDATION_FAILED",
  );
  assert.equal(requireIdempotencyKey("12345678"), "12345678");
  assert.equal(parseAfterSequence(null, null), 0);
  assert.equal(parseAfterSequence("", "7"), 7);
  assert.equal(
    codeOf(() => parseAfterSequence("-1")),
    "VALIDATION_FAILED",
  );
});

test("결정 응답 판단: 처음 응답은 받고 같은 응답은 재생하고 다른 응답은 거절한다", () => {
  assert.equal(evaluateDecisionResponse(open, waiting, approve), "accept");
  const answered: DecisionState = {
    ...open,
    status: "ANSWERED",
    response: { choice: "APPROVE", optionId: null, comment: null },
  };
  assert.equal(evaluateDecisionResponse(answered, waiting, approve), "replay");
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(answered, waiting, {
        proposalVersion: 2,
        choice: "REQUEST_CHANGES",
        comment: "수정",
      }),
    ),
    "DECISION_ALREADY_ANSWERED",
  );
});

test("결정 응답 판단: 제안 버전, 정지, 상태, 선택지 오류", () => {
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(open, waiting, {
        ...approve,
        proposalVersion: 1,
      }),
    ),
    "PROPOSAL_VERSION_MISMATCH",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(
        open,
        { status: "WAITING_CEO", pauseRequested: true },
        approve,
      ),
    ),
    "RUN_PAUSED",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(
        open,
        { status: "PAUSED", pauseRequested: false },
        approve,
      ),
    ),
    "RUN_PAUSED",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(
        open,
        { status: "RUNNING", pauseRequested: false },
        approve,
      ),
    ),
    "DECISION_NOT_OPEN",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(
        { ...open, status: "PREPARED" },
        waiting,
        approve,
      ),
    ),
    "DECISION_NOT_OPEN",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(
        { ...open, status: "SUPERSEDED" },
        waiting,
        approve,
      ),
    ),
    "DECISION_NOT_OPEN",
  );
  const exception: DecisionState = {
    ...open,
    kind: "EXCEPTION",
    optionIds: ["a", "b"],
  };
  assert.equal(
    codeOf(() => evaluateDecisionResponse(exception, waiting, approve)),
    "VALIDATION_FAILED",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(exception, waiting, {
        proposalVersion: 2,
        choice: "SELECT_OPTION",
        optionId: "z",
      }),
    ),
    "VALIDATION_FAILED",
  );
  assert.equal(
    evaluateDecisionResponse(exception, waiting, {
      proposalVersion: 2,
      choice: "SELECT_OPTION",
      optionId: "a",
    }),
    "accept",
  );
  assert.equal(
    codeOf(() =>
      evaluateDecisionResponse(open, waiting, {
        proposalVersion: 2,
        choice: "SELECT_OPTION",
        optionId: "a",
      }),
    ),
    "VALIDATION_FAILED",
  );
});

test("Run 시작 규칙", () => {
  const base = {
    type: "INITIAL",
    archived: false,
    totalRuns: 0,
    succeededRuns: 0,
  } as const;
  assert.equal(
    codeOf(() => assertCanStartRun(base)),
    "NO_ERROR",
  );
  assert.equal(
    codeOf(() => assertCanStartRun({ ...base, archived: true })),
    "INVALID_RUN_STATE",
  );
  assert.equal(
    codeOf(() => assertCanStartRun({ ...base, totalRuns: 1 })),
    "INVALID_RUN_STATE",
  );
  assert.equal(
    codeOf(() => assertCanStartRun({ ...base, type: "REVISION" })),
    "INVALID_RUN_STATE",
  );
  assert.equal(
    codeOf(() =>
      assertCanStartRun({
        ...base,
        type: "REVISION",
        totalRuns: 1,
        succeededRuns: 1,
      }),
    ),
    "NO_ERROR",
  );
});

test("지원 범위 사전 확인은 알려진 범위 밖 요구만 잡고 부정 표현은 제외한다", () => {
  assert.equal(
    checkScope({ idea: "로그인 없이 쓰는 공부 기록 앱" }).supported,
    true,
  );
  assert.equal(
    checkScope({ idea: "회원가입과 로그인이 있는 가계부" }).supported,
    false,
  );
  const result = checkScope({ idea: "결제가 되는 모바일 앱" });
  assert.deepEqual(
    result.gaps.map((gap) => gap.requirement),
    ["결제", "모바일 네이티브 앱"],
  );
});

test("일시정지·재개·재시도 판단", () => {
  assert.equal(
    decidePause({ status: "QUEUED", pauseRequested: false }),
    "pause-now",
  );
  assert.equal(
    decidePause({ status: "WAITING_CEO", pauseRequested: false }),
    "pause-now",
  );
  assert.equal(
    decidePause({ status: "BLOCKED", pauseRequested: false }),
    "pause-now",
  );
  assert.equal(
    decidePause({ status: "RUNNING", pauseRequested: false }),
    "request",
  );
  assert.equal(
    decidePause({ status: "RUNNING", pauseRequested: true }),
    "already",
  );
  assert.equal(
    decidePause({ status: "PAUSED", pauseRequested: false }),
    "already",
  );
  assert.equal(
    codeOf(() => decidePause({ status: "FAILED", pauseRequested: false })),
    "INVALID_RUN_STATE",
  );

  const paused = {
    status: "PAUSED",
    pauseRequested: false,
    blockedReason: null,
    hasOpenDecision: false,
  } as const;
  assert.equal(decideResume(paused), "to-queued");
  assert.equal(
    decideResume({ ...paused, hasOpenDecision: true }),
    "to-waiting",
  );
  assert.equal(
    decideResume({ ...paused, blockedReason: "LIMIT_REACHED" }),
    "to-blocked",
  );
  assert.equal(
    decideResume({
      ...paused,
      blockedReason: "LIMIT_REACHED",
      hasOpenDecision: true,
    }),
    "to-blocked",
  );
  assert.equal(
    decideResume({ ...paused, status: "RUNNING", pauseRequested: true }),
    "cancel-request",
  );
  assert.equal(decideResume({ ...paused, status: "QUEUED" }), "already");
  assert.equal(
    codeOf(() => decideResume({ ...paused, status: "SUCCEEDED" })),
    "INVALID_RUN_STATE",
  );

  assert.equal(
    decideRetry({
      status: "FAILED",
      projectGeneration: 2,
      latestProjectGeneration: 2,
    }),
    "retry",
  );
  assert.equal(
    decideRetry({
      status: "QUEUED",
      projectGeneration: 2,
      latestProjectGeneration: 2,
    }),
    "already",
  );
  assert.equal(
    codeOf(() =>
      decideRetry({
        status: "FAILED",
        projectGeneration: 1,
        latestProjectGeneration: 2,
      }),
    ),
    "STALE_GENERATION",
  );
  assert.equal(
    codeOf(() =>
      decideRetry({
        status: "PAUSED",
        projectGeneration: 2,
        latestProjectGeneration: 2,
      }),
    ),
    "INVALID_RUN_STATE",
  );
});

const demoContext: DemoContext = {
  projectName: "독서 기록",
  idea: "읽은 책을 날짜와 메모로 기록하는 서비스",
  purpose: null,
  constraints: null,
  feedback: [],
};

test("회의 대본은 길고, 참여자 안에서만 말하며, 반응이 발언 사이에 섞여 있다", () => {
  const kinds: ReviewKind[] = [
    "SCOPE_REVIEW",
    "DESIGN_REVIEW",
    "INTEGRATED_REVIEW",
  ];
  for (const kind of kinds) {
    const script = reviewMeeting(kind, demoContext);
    const statements = script.beats.filter((beat) => beat.kind === "STATEMENT");
    const reactions = script.beats.filter((beat) => beat.kind === "REACTION");
    assert.ok(statements.length >= 9, `${kind}: 발언이 충분히 길어야 한다`);
    assert.ok(reactions.length >= 5, `${kind}: 반응이 있어야 한다`);
    const participants = REVIEWS[kind].participants;
    for (const beat of script.beats)
      assert.ok(
        participants.includes(beat.role),
        `${kind}: ${beat.role}는 참여자가 아니다`,
      );
    // 반응은 발언이 모두 끝난 뒤가 아니라 중간에 나온다.
    const firstReaction = script.beats.findIndex(
      (beat) => beat.kind === "REACTION",
    );
    const lastStatement = script.beats
      .map((beat) => beat.kind)
      .lastIndexOf("STATEMENT");
    assert.ok(
      firstReaction < lastStatement,
      `${kind}: 반응이 발언 사이에 섞여야 한다`,
    );
    assert.ok(
      script.beats.length === new Set(script.beats.map((_, i) => i)).size,
    );
  }
  const internal = internalMeeting();
  assert.ok(
    internal.beats.filter((beat) => beat.kind === "STATEMENT").length >= 7,
  );
  const team = ["PM", "PLANNER", "DESIGNER", "DEVELOPER"];
  for (const beat of internal.beats) assert.ok(team.includes(beat.role));
});

test("회의 대본은 기획자가 아이디어를 내지만 범위를 마음대로 늘리지 않는다", () => {
  const script = reviewMeeting("SCOPE_REVIEW", demoContext);
  const planner = script.beats.filter(
    (beat) => beat.kind === "STATEMENT" && beat.role === "PLANNER",
  );
  assert.ok(planner.length >= 3);
  const text = script.beats
    .map((beat) => (beat.kind === "STATEMENT" ? beat.summary : ""))
    .join("\n");
  assert.ok(text.includes("태그"), "기획자가 새 아이디어를 낸다");
  assert.ok(
    text.includes("후보"),
    "새 아이디어는 확정 범위가 아니라 후보로 남는다",
  );
  assert.ok(text.includes(demoContext.projectName));
});

test("수정 요청이 있으면 회의가 대표의 의견으로 시작하는 장면을 더한다", () => {
  const withFeedback = reviewMeeting("SCOPE_REVIEW", {
    ...demoContext,
    feedback: ["공부 시간도 기록하고 싶어요"],
  });
  const without = reviewMeeting("SCOPE_REVIEW", demoContext);
  assert.ok(withFeedback.beats.length > without.beats.length);
  const text = withFeedback.beats
    .map((beat) => (beat.kind === "STATEMENT" ? beat.summary : ""))
    .join("\n");
  assert.ok(text.includes("공부 시간도 기록하고 싶어요"));
  assert.ok(
    !without.beats.some(
      (beat) =>
        beat.kind === "STATEMENT" &&
        beat.summary.includes("대표님 의견이 들어왔어요"),
    ),
  );
});
