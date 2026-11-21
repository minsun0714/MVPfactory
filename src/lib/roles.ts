type Context = { idea: string; requirements: string; previous: string };
export type RoleOutput = Record<string, string>;

export function pm(c: Context): RoleOutput {
  return {
    입력과_제약: c.idea,
    진행_요약:
      "요구사항을 정리하고 기획, 디자인, 개발 계획을 순서대로 작성합니다.",
    결정: "CEO 개입 수준에 따라 검토합니다.",
  };
}
export function planner(c: Context): RoleOutput {
  return {
    목적: `${c.idea}에 필요한 최소 제품을 정의합니다.`,
    핵심_기능: `요구사항: ${c.requirements}`,
    데이터_항목: "사용자 입력과 핵심 기록",
    완료_조건: "핵심 흐름과 오류 상태를 확인합니다.",
  };
}
export function designer(c: Context): RoleOutput {
  return {
    화면_목록: "목록, 상세, 입력 화면",
    화면_구성: `기획과 요구사항을 반영합니다: ${c.requirements}`,
    상태: "빈 화면, 로딩, 오류 및 재시도 상태를 표시합니다.",
  };
}
export function developer(c: Context): RoleOutput {
  return {
    구현_계획: `Next.js 화면과 서버를 구성합니다. 요구사항: ${c.requirements}`,
    앞선_결과: c.previous,
    검증_항목: "핵심 흐름, 입력 검증, 데이터 보존과 오류 처리를 검증합니다.",
  };
}
export function validateOutput(
  output: RoleOutput,
  required: string[],
): RoleOutput {
  for (const key of required) {
    if (typeof output[key] !== "string" || !output[key].trim())
      throw new Error(`역할 산출물의 필수 항목이 없습니다: ${key}`);
  }
  return output;
}
