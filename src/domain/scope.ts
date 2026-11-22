import type {
  ScopeCheckRequest,
  ScopeCheckResult,
  ScopeGap,
} from "@/contracts/projects";

type Rule = { pattern: RegExp; gap: ScopeGap };

export class UnsupportedAuthenticationError extends Error {
  /** @param evidence 인증이 필요하다고 본 근거(대표 입력에서 그대로 옮긴 문장) */
  constructor(readonly evidence?: string) {
    super(
      [
        evidence
          ? `대표님 입력의 "${evidence}" 때문에 로그인·계정·사용자별 비공개 데이터가 필요하다고 판단했어요.`
          : "",
        "로그인·회원가입·OAuth·사용자별 비공개 데이터는 현재 생성 범위 밖이에요. 인증이 필요한 요구를 없애거나 데이터를 공개하지 않고 중단했어요.",
        evidence
          ? "로그인 없이 써도 된다면 그 요구를 빼고 다시 시작해 주세요."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    this.name = "UnsupportedAuthenticationError";
  }
}

/** 키워드 사전 안내용이다. 최종 판단은 기획자의 명시적인 인증 필요성 선언으로 한다. */
function mentionsAuthentication(value: string): boolean {
  const auth =
    "(?:로그인|회원가입|회원 가입|OAuth|소셜 로그인|login|sign[ -]?up)";
  const withoutExclusions = value
    .replace(
      new RegExp(
        `${auth}(?:\\s*(?:과|와|및|[·,/])\\s*${auth})*\\s*(?:은|는|을|를)?\\s*(?:없이|없는|불필요|제외|안\\s*(?:만들|넣|쓰|함)|하지\\s*않)`,
        "gi",
      ),
      "",
    )
    .replace(/(?:no|without)\s+(?:login|sign[ -]?up|oauth)/gi, "");
  return new RegExp(auth, "i").test(withoutExclusions);
}

const RULES: Rule[] = [
  {
    pattern: /(결제|구독\s*결제|stripe|payment)/i,
    gap: {
      requirement: "결제",
      reason: "생성 앱의 결제는 첫 MVP 범위 밖입니다.",
      alternative: "결제 없이 기록·목록 관리 기능부터 만듭니다.",
    },
  },
  {
    pattern: /(실시간\s*(공동|협업)\s*편집|동시\s*편집|공동\s*편집)/,
    gap: {
      requirement: "실시간 공동 편집",
      reason: "여러 사용자의 실시간 공동 편집은 지원하지 않습니다.",
      alternative: "한 사람이 쓰는 개인용 도구로 범위를 줄입니다.",
    },
  },
  {
    pattern:
      /(모바일\s*앱|네이티브\s*앱|ios\s*앱|안드로이드\s*앱|android\s*앱)/i,
    gap: {
      requirement: "모바일 네이티브 앱",
      reason: "생성 대상은 Next.js 웹앱입니다.",
      alternative: "모바일 화면에서도 쓸 수 있는 반응형 웹앱으로 만듭니다.",
    },
  },
  {
    pattern:
      /(기존\s*(깃허브|github)?\s*저장소|기존\s*코드를?\s*(가져|분석|수정))/i,
    gap: {
      requirement: "기존 저장소 가져오기",
      reason: "임의의 기존 저장소를 가져와 수정하는 기능은 지원하지 않습니다.",
      alternative: "새 저장소에서 처음부터 만듭니다.",
    },
  },
  {
    pattern: /(외부\s*api\s*(연동|연결|통합))/i,
    gap: {
      requirement: "외부 API 연동",
      reason: "임의의 외부 API 통합은 첫 MVP 범위 밖입니다.",
      alternative: "외부 연동 없이 앱 안의 데이터만으로 동작하게 합니다.",
    },
  },
];

/**
 * 아이디어에 이미 알려진 지원 범위 밖 요구가 있는지 키워드로 사전 확인한다.
 * `supported: true`는 "명백한 범위 밖 표현이 없다"는 뜻이며 구현 가능하다는 보증이 아니다.
 * 최종 판단은 기획 단계에서 한다.
 */
export function checkScope(input: ScopeCheckRequest): ScopeCheckResult {
  const haystack = [input.idea, input.purpose, input.constraints]
    .filter(Boolean)
    .join("\n");
  const gaps = RULES.filter((rule) => rule.pattern.test(haystack)).map(
    (rule) => rule.gap,
  );
  if (mentionsAuthentication(haystack))
    gaps.push({
      requirement: "로그인·회원가입·OAuth",
      reason:
        "생성 앱의 인증과 사용자별 비공개 데이터는 현재 지원하지 않습니다.",
      alternative:
        "인증 없이 사용해도 되는 기능으로 직접 범위를 조정해 주세요. 비공개 데이터를 자동으로 공개하지 않습니다.",
    });
  return { supported: gaps.length === 0, gaps };
}
