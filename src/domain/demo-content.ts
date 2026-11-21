/**
 * 데모(DEMO) 실행의 예시 산출물. 입력한 아이디어를 바탕으로 한 결정적인 문장이며,
 * 실제 AI가 만든 것이 아니다. 모든 산출물에 데모 안내를 넣어 실제 결과와 구분한다.
 */
import type { RoleId } from "@/contracts/common";
import type { ReviewKind } from "@/domain/workflow";

export type DemoContext = {
  projectName: string;
  idea: string;
  purpose: string | null;
  constraints: string | null;
  /** 대표의 수정 요청(최신이 마지막). 산출물에 반영된다. */
  feedback: string[];
};

export const DEMO_NOTICE =
  "데모 산출물입니다. 입력한 아이디어로 만든 예시이며 실제 AI 생성이나 코드는 포함되지 않습니다.";

const feedbackLine = (feedback: string[]) =>
  feedback.length > 0 ? feedback.map((line) => `- ${line}`).join("\n") : "없음";

export function intakeBrief(c: DemoContext): Record<string, string> {
  return {
    "데모 안내": DEMO_NOTICE,
    "입력한 아이디어": c.idea,
    목적: c.purpose ?? "입력하지 않았어요",
    제약: c.constraints ?? "입력하지 않았어요",
    "지원 범위": "작은 개인용 웹 도구, 화면 1~3개, 로그인 없음",
  };
}

export function productSpec(c: DemoContext): Record<string, string> {
  return {
    "데모 안내": DEMO_NOTICE,
    목적: `${c.projectName}: ${c.idea}에 필요한 최소 제품을 정의합니다.`,
    "핵심 기능": [
      "기록 만들기",
      "목록 보기",
      "수정과 삭제",
      "저장한 뒤 다시 접속해도 유지",
    ].join(" · "),
    데이터: "날짜, 제목, 메모",
    "완료 조건": "핵심 흐름과 입력 오류, 빈 목록 상태를 확인합니다.",
    "반영한 수정 요청": feedbackLine(c.feedback),
  };
}

export function screenPlan(c: DemoContext): Record<string, string> {
  return {
    "데모 안내": DEMO_NOTICE,
    화면: "목록 · 입력 · 상세",
    상태: "빈 목록, 불러오는 중, 입력 오류, 저장 실패를 각각 표시합니다.",
    연결: `${c.projectName}의 핵심 기능마다 시작하는 화면과 결과를 확인하는 화면을 연결합니다.`,
    "반영한 수정 요청": feedbackLine(c.feedback),
  };
}

export function implementationPlan(c: DemoContext): Record<string, string> {
  return {
    "데모 안내": DEMO_NOTICE,
    "구현 계획": `Next.js 화면과 서버를 구성합니다. 요구사항: ${c.idea}`,
    "검증 항목": "핵심 흐름, 입력 검증, 데이터 보존, 오류 처리",
    "아직 하지 않은 일":
      "실제 코드 생성, 저장소 반영, 배포는 수행하지 않았습니다.",
  };
}

export const DELEGATION_RATIONALE: Record<string, string> = {
  "적용 정책": "위임형: 예정된 중간 검토 없이 진행합니다.",
  근거: "기획과 화면 구성을 기준으로 개발 계획을 진행합니다. CEO 응답은 없었습니다.",
};

export type DecisionDraft = {
  title: string;
  summary: string;
  proposal: { heading: string; items: string[] }[];
};

/** 검토 지점에 올릴 제안을 만든다. 제안 내용은 이미 만든 산출물에서만 가져온다. */
export function proposalFor(
  kind: ReviewKind,
  spec: Record<string, string> | null,
  screens: Record<string, string> | null,
): DecisionDraft {
  const features = (spec?.["핵심 기능"] ?? "").split(" · ").filter(Boolean);
  const screenList = (screens?.["화면"] ?? "").split(" · ").filter(Boolean);
  const featureSection = { heading: "이번에 만들 기능", items: features };
  const screenSection = { heading: "화면", items: screenList };
  const completion = {
    heading: "완료 조건",
    items: [spec?.["완료 조건"] ?? ""].filter(Boolean),
  };
  if (kind === "SCOPE_REVIEW")
    return {
      title: "이 범위로 시작할까요?",
      summary: "기능 범위를 먼저 확인받고 싶어요.",
      proposal: [featureSection, completion],
    };
  if (kind === "DESIGN_REVIEW")
    return {
      title: "화면 방향은 이렇게 갈까요?",
      summary: "확정한 기능 범위에 맞춘 화면 구성이에요.",
      proposal: [screenSection],
    };
  return {
    title: "첫 버전, 이렇게 만들까요?",
    summary: "기능과 화면을 함께 정리했어요.",
    proposal: [featureSection, screenSection, completion],
  };
}

/** 회의의 한 장면. 발언과 반응을 말한 순서대로 섞어서 둔다(반응이 발언 사이에 나온다). */
export type MeetingBeat =
  | { kind: "STATEMENT"; role: RoleId; summary: string }
  | { kind: "REACTION"; role: RoleId; reaction: "NOD" | "THINK" | "ALERT" };

export type MeetingScript = { topic: string; beats: MeetingBeat[] };

const say = (role: RoleId, summary: string): MeetingBeat => ({
  kind: "STATEMENT",
  role,
  summary,
});
const react = (
  role: RoleId,
  reaction: "NOD" | "THINK" | "ALERT",
): MeetingBeat => ({
  kind: "REACTION",
  role,
  reaction,
});

/** 회의에 올릴 아이디어는 길면 잘라서 말풍선에 맞춘다. */
const brief = (text: string, max = 28) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * 대표가 이전 제안에 수정을 요청했다면 회의가 그 의견으로 시작한다.
 * 의견은 대표가 쓴 그대로 옮기고, 팀이 반영한다고 말하는 것은 산출물을 다시 만들었다는 사실과 같다.
 */
function revisionBeats(c: DemoContext, designerFirst = false): MeetingBeat[] {
  const last = c.feedback.at(-1);
  if (!last) return [];
  return [
    say(
      "PM",
      `대표님 의견이 들어왔어요. "${brief(last, 40)}" 이걸 반영해서 다시 정리해 봐요.`,
    ),
    react("PLANNER", "NOD"),
    say(
      designerFirst ? "DESIGNER" : "PLANNER",
      designerFirst
        ? "그 의견에 맞춰 화면 구성을 다시 손봤어요."
        : "그 의견을 기능 목록과 완료 조건에 녹여서 다시 짰어요.",
    ),
    react("DEVELOPER", "THINK"),
  ];
}

export function reviewMeeting(kind: ReviewKind, c: DemoContext): MeetingScript {
  if (kind === "SCOPE_REVIEW")
    return {
      topic: "기능 범위 검토",
      beats: [
        say(
          "PM",
          "회의 시작할게요. 오늘 안건은 '어디까지 만들 것인가'예요. 시간은 유한한데 아이디어는 무한하니까요.",
        ),
        react("PLANNER", "NOD"),
        ...revisionBeats(c),
        say(
          "PLANNER",
          `${c.projectName}의 핵심은 "${brief(c.idea)}"이에요. 기록 만들기, 목록 보기, 수정과 삭제, 저장 후에도 유지, 이렇게 네 가지로 가면 어떨까요?`,
        ),
        react("PM", "NOD"),
        say(
          "PLANNER",
          "아, 하나 더요! 기록마다 태그를 달 수 있으면 나중에 찾기 편할 것 같아요.",
        ),
        react("DEVELOPER", "THINK"),
        say(
          "DEVELOPER",
          "태그는 데이터 구조가 하나 늘어요. 첫 버전에는 무겁습니다.",
        ),
        say("PLANNER", "그럼 검색은요? 제목으로만 찾는 간단한 검색이요."),
        react("DESIGNER", "NOD"),
        say(
          "DESIGNER",
          "검색창 하나쯤은 화면이 크게 복잡해지지 않아서 괜찮아 보여요.",
        ),
        react("PM", "ALERT"),
        say(
          "PM",
          "잠깐만요. 아이디어가 벌써 세 개째예요. 필수와 후보로 나눠 볼까요?",
        ),
        say(
          "PLANNER",
          "좋아요. 네 가지는 필수로 확정하고, 태그와 검색은 '여유가 있으면' 후보로 적어 둘게요.",
        ),
        react("DEVELOPER", "NOD"),
        say(
          "DEVELOPER",
          "후보는 이번에 만들지 않는 걸로 하죠. 필수만 확실하게 끝내는 쪽이 안전합니다.",
        ),
        react("DESIGNER", "NOD"),
        say(
          "PM",
          "정리할게요. 필수 네 가지로 시작하고, 태그와 검색은 다음 버전 후보예요. 대표님께 확인받으러 갑니다.",
        ),
        react("PLANNER", "NOD"),
      ],
    };
  if (kind === "DESIGN_REVIEW")
    return {
      topic: "화면 방향 검토",
      beats: [
        say(
          "PM",
          "기능 범위는 확정됐어요. 이제 그 기능을 화면으로 어떻게 풀지 이야기해 봐요.",
        ),
        ...revisionBeats(c, true),
        say(
          "DESIGNER",
          "화면은 목록, 입력, 상세 세 개로 나눴어요. 한 화면에 다 넣고 싶은 마음을 꾹 눌렀습니다.",
        ),
        react("PM", "NOD"),
        say(
          "PM",
          "첫 화면에서 바로 기록을 시작할 수 있어야 해요. 버튼은 눈에 잘 띄게요.",
        ),
        say(
          "DESIGNER",
          "목록 맨 위에 '새 기록' 버튼을 크게 둘게요. 여백은 넉넉하게요.",
        ),
        say(
          "PLANNER",
          "빈 목록일 때 문구는 '아직 기록이 없어요. 첫 기록을 남겨 보세요'는 어때요?",
        ),
        react("DESIGNER", "THINK"),
        say(
          "DESIGNER",
          "좋아요. 거기에 작은 일러스트를 하나 넣으면 훨씬 따뜻해 보일 것 같아요.",
        ),
        say(
          "DEVELOPER",
          "일러스트는 이미지 하나 더 불러오는 정도라 부담 없습니다. 대신 입력 오류 표시는 확실히 정해 주세요.",
        ),
        say(
          "DESIGNER",
          "필수 칸이 비면 칸 아래에 빨간 안내를 바로 보여 줄게요.",
        ),
        react("PM", "NOD"),
        say("PLANNER", "저장에 실패하면요? 입력한 내용이 지워지면 안 돼요."),
        react("DEVELOPER", "ALERT"),
        say("DEVELOPER", "맞아요. 실패해도 입력값은 화면에 남겨 두겠습니다."),
        say(
          "PM",
          "모바일에서도 쓸 수 있어야 해요. 버튼이 손가락으로 누르기 쉬운 크기인지도 봐 주세요.",
        ),
        say("DESIGNER", "네, 터치하는 영역은 넉넉히 잡을게요."),
        react("PLANNER", "NOD"),
        say("PM", "좋아요. 이 화면 방향으로 대표님께 확인받겠습니다."),
      ],
    };
  return {
    topic: "기능·화면 통합안 검토",
    beats: [
      say(
        "PM",
        "자, 모두 모였죠? 대표님께 올리기 전에 기능과 화면을 한 번에 맞춰 봐요.",
      ),
      react("PLANNER", "NOD"),
      ...revisionBeats(c),
      say(
        "PLANNER",
        `${c.projectName}은 기록 만들기, 목록 보기, 수정과 삭제, 저장 후 유지 네 가지를 핵심으로 잡았어요. "${brief(c.idea)}"를 가장 작게 풀어 본 거예요.`,
      ),
      say(
        "PLANNER",
        "솔직히 아이디어가 더 있었는데요, 태그나 검색 같은 건 다음 버전 후보로 남겨 뒀어요. 참았습니다.",
      ),
      react("PM", "NOD"),
      say(
        "DESIGNER",
        "그 기능마다 시작하는 화면을 이어 붙였어요. 목록에서 입력으로, 입력에서 다시 목록으로 자연스럽게 돌아와요.",
      ),
      say(
        "PM",
        "빈 목록, 불러오는 중, 입력 오류, 저장 실패. 이 네 가지 상태는 화면마다 있는 거죠?",
      ),
      react("DESIGNER", "NOD"),
      say("DESIGNER", "네, 상태마다 문구와 다음 행동을 정해 뒀어요."),
      say(
        "DEVELOPER",
        "구현 쪽에서 보면 화면 세 개에 데이터는 날짜, 제목, 메모 세 칸이라 작게 끝낼 수 있습니다.",
      ),
      react("PLANNER", "THINK"),
      say(
        "PLANNER",
        "그럼 완료 조건은 '저장한 뒤 다시 들어와도 기록이 그대로 있다'로 해도 될까요?",
      ),
      react("DEVELOPER", "NOD"),
      say("DEVELOPER", "좋습니다. 그건 제가 끝나고 직접 확인하겠습니다."),
      react("PM", "ALERT"),
      say(
        "PM",
        "한 가지만요. 지금 정리한 것만 만들 거예요. 중간에 기능을 더하는 건 대표님이 정하시는 거고요.",
      ),
      say("PLANNER", "네네, 알겠습니다. 아이디어는 노트에 잘 적어 둘게요."),
      say(
        "PM",
        "좋아요. 이 통합안으로 대표님께 확인받고, 승인되면 개발 계획으로 넘어갈게요.",
      ),
      react("DESIGNER", "NOD"),
    ],
  };
}

/** 위임형: CEO 응답 없이 팀이 내부에서 확정하는 회의 */
export function internalMeeting(): MeetingScript {
  return {
    topic: "내부 확정 회의",
    beats: [
      say(
        "PM",
        "대표님이 중간 검토는 우리에게 맡기셨어요. 그만큼 신중하게 정해요.",
      ),
      react("PLANNER", "NOD"),
      say(
        "PLANNER",
        "기능은 기록 만들기, 목록 보기, 수정과 삭제, 저장 후 유지 네 가지로 정리했어요.",
      ),
      say(
        "PLANNER",
        "태그나 검색도 넣고 싶지만, 맡기셨다고 범위를 마음대로 늘리면 안 되겠죠?",
      ),
      react("PM", "ALERT"),
      say(
        "PM",
        "맞아요. 위임받은 건 판단이지 범위를 넓히는 권한이 아니에요. 필수만 갑니다.",
      ),
      react("DEVELOPER", "NOD"),
      say(
        "DESIGNER",
        "화면도 그 범위에 맞춰 목록, 입력, 상세 세 개로 정리했어요.",
      ),
      say(
        "DEVELOPER",
        "작은 범위라 구현 계획도 단순하게 나옵니다. 완료 조건은 저장 후에도 기록이 남는 것으로 두죠.",
      ),
      react("DESIGNER", "NOD"),
      say("PM", "좋아요. 이 근거를 남기고 개발 계획으로 넘어가요."),
      react("PLANNER", "NOD"),
    ],
  };
}

export function approvalOutcome(
  choice: "APPROVE" | "REQUEST_CHANGES" | "SELECT_OPTION",
  comment: string | null,
) {
  return choice === "REQUEST_CHANGES"
    ? `수정 요청을 받았어요: ${comment ?? ""}`.trim()
    : "대표님이 승인했어요.";
}
