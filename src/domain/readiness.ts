/**
 * 실제(REAL) 실행을 시작할 수 있는지 판단하는 규칙. 순수 함수이며 비밀값을 다루지 않는다.
 *
 * "준비됨"은 필요한 항목이 **하나도 빠짐없이** 갖춰졌을 때만이다. 토큰이 있다는 사실만으로,
 * 또는 연동 확인이 한 번 성공했다는 사실만으로 준비 완료로 보지 않는다.
 * 어댑터(실제로 일을 하는 코드)가 없으면 자격 증명이 있어도 준비되지 않은 것이다.
 */

export type RequirementId =
  "LLM" | "SANDBOX" | "GITHUB" | "VERCEL" | "SUPABASE" | "LIMITS";

/** 항목 하나의 현재 사실. 인프라가 모아서 넘긴다. */
export type RequirementFacts = {
  id: RequirementId;
  label: string;
  /** 확정되지 않은 결정(예: DEC-002). 미정이면 구현하거나 고를 수 없다. */
  undecided: string[];
  /** 아직 구현되지 않은 어댑터 이름 */
  missingAdapters: string[];
  /** 비어 있는 비밀 키의 환경변수 이름(값은 다루지 않는다) */
  missingCredentials: string[];
  /** 권한 확인이 끝나지 않았거나 실패한 연결 */
  unverifiedConnection: string | null;
  /** 설정이 필요한 값(예: 실행 한도) */
  missingSettings: string[];
};

export type RequirementState = {
  id: RequirementId;
  label: string;
  ready: boolean;
  blockers: string[];
};

export type ReadinessAssessment = {
  available: boolean;
  /** 사용자에게 그대로 보여 줄 수 있는 한 문장. 비밀값을 담지 않는다. */
  reason: string | null;
  requirements: RequirementState[];
};

function blockersOf(facts: RequirementFacts): string[] {
  const blockers: string[] = [];
  for (const item of facts.undecided) blockers.push(`결정 필요: ${item}`);
  for (const adapter of facts.missingAdapters)
    blockers.push(`${adapter} 미구현`);
  for (const name of facts.missingCredentials)
    blockers.push(`.env의 ${name} 비어 있음`);
  if (facts.unverifiedConnection) blockers.push(facts.unverifiedConnection);
  for (const setting of facts.missingSettings)
    blockers.push(`${setting} 설정 필요`);
  return blockers;
}

export function evaluateReadiness(
  facts: RequirementFacts[],
): ReadinessAssessment {
  const requirements = facts.map((item): RequirementState => {
    const blockers = blockersOf(item);
    return {
      id: item.id,
      label: item.label,
      ready: blockers.length === 0,
      blockers,
    };
  });
  const missing = requirements.filter((item) => !item.ready);
  if (missing.length === 0)
    return { available: true, reason: null, requirements };
  const summary = missing
    .map((item) => `${item.label}(${item.blockers.join(", ")})`)
    .join(" · ");
  return {
    available: false,
    reason: `실제 실행에 필요한 준비가 끝나지 않았어요. ${summary}`,
    requirements,
  };
}
