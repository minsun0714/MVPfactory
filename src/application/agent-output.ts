/** 모델 응답의 구조와 문서 연결을 검증한다. 형식 오류만 재요청 대상이다. */
import type {
  AgentContext,
  DesignGuide,
  ReviewIssue,
} from "@/application/agents";
import type { RoleId } from "@/contracts/common";
import { ARTIFACT_LIST_SEPARATOR } from "@/contracts/runs";
import type { MeetingBeat, MeetingScript } from "@/domain/demo-content";
import {
  ACCESS_ACTIONS,
  DataPlanError,
  UnsupportedDataAccessError,
  parseDataPlan,
  type DataPlan,
} from "@/domain/data-plan";
import {
  CRITERION_ID,
  REQUIREMENT_ID,
  SCREEN_ID,
  SURFACE_MODES,
  designProblems,
  planProblems,
  renderDesign,
  renderPlan,
  type ProductPlanDocument,
  type ScreenDesignDocument,
  type Criterion,
  type DataUse,
  type DesignBrief,
  type Requirement,
  type Screen,
} from "@/domain/product-documents";
import { UnsupportedAuthenticationError } from "@/domain/scope";
import type { SourceFileInput } from "@/domain/sandbox";

export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentOutputError";
  }
}

export type Obj = Record<string, unknown>;

export function parseObject(text: string): Obj {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgentOutputError("모델 출력이 JSON이 아니에요.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AgentOutputError("모델 출력이 JSON 객체가 아니에요.");
  return value as Obj;
}

/** 문장 항목. 모델이 짧은 문장 배열로 줘도 의미가 같으므로 ` · `로 이어 받는다. */
export function text(obj: Obj, key: string, max = 600): string {
  let value = obj[key];
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim())
  )
    value = (value as string[])
      .map((item) => item.trim())
      .join(ARTIFACT_LIST_SEPARATOR);
  if (typeof value !== "string" || !value.trim())
    throw new AgentOutputError(`"${key}" 항목이 비어 있어요.`);
  if (value.length > max)
    throw new AgentOutputError(`"${key}" 항목이 너무 길어요.`);
  return value.trim();
}

export function list(
  obj: Obj,
  key: string,
  min: number,
  max: number,
): string[] {
  const value = obj[key];
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 160,
    )
  )
    throw new AgentOutputError(
      `"${key}" 목록은 ${min}~${max}개의 짧은 문장이어야 해요.`,
    );
  return (value as string[]).map((item) => item.trim());
}

export function objects(o: Obj, key: string, min: number, max: number): Obj[] {
  const value = o[key];
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    value.some((v) => !v || typeof v !== "object" || Array.isArray(v))
  )
    throw new AgentOutputError(
      `"${key}"는 ${min}~${max}개의 객체 배열이어야 해요.`,
    );
  return value as Obj[];
}

function id(o: Obj, pattern: RegExp, example: string): string {
  const value = o["id"];
  if (typeof value !== "string" || !pattern.test(value.trim()))
    throw new AgentOutputError(
      `id 형식이 틀렸어요(${String(value)}). ${example} 형식으로 쓰세요.`,
    );
  return value.trim();
}

export function parseRequirement(o: Obj): Requirement {
  const uses = o["데이터사용"] ?? [];
  if (!Array.isArray(uses))
    throw new AgentOutputError('"데이터사용"은 배열이어야 해요.');
  const dataUses: DataUse[] = uses.map((u) => {
    const use = (u ?? {}) as Obj;
    const action = ACCESS_ACTIONS.find((a) => a === use["동작"]);
    if (typeof use["테이블"] !== "string" || !action)
      throw new AgentOutputError(
        '"데이터사용"의 각 항목은 {"테이블":"이름","동작":"read|insert|update|delete"}여야 해요.',
      );
    return { table: use["테이블"], action };
  });
  return {
    id: id(o, REQUIREMENT_ID, "APP-REQ-001"),
    name: text(o, "이름", 80),
    flow: list(o, "흐름", 1, 6),
    dataUses,
  };
}

export function parseCriterion(o: Obj): Criterion {
  const requirementId = o["기능"];
  if (typeof requirementId !== "string" || !requirementId.trim())
    throw new AgentOutputError('완료조건의 "기능"에 기능 id를 적어야 해요.');
  return {
    id: id(o, CRITERION_ID, "APP-AC-001"),
    requirementId: requirementId.trim(),
    statement: text(o, "내용", 160),
  };
}

export function parseScreen(o: Obj): Screen {
  return {
    id: id(o, SCREEN_ID, "SCR-001"),
    name: text(o, "이름", 60),
    requirementIds: list(o, "기능", 1, 6),
    primaryAction: text(o, "주행동", 120),
    actions: list(o, "행동", 1, 6),
    states: {
      normal: text(o, "정상", 200),
      empty: text(o, "빈상태", 200),
      loading: text(o, "로딩", 200),
      error: text(o, "오류", 200),
    },
  };
}

export function parseBrief(o: Obj): DesignBrief {
  const raw = o["브리프"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AgentOutputError('"브리프"는 객체여야 해요.');
  const brief = raw as Obj;
  const mode = SURFACE_MODES.find((m) => m === brief["모드"]);
  if (!mode)
    throw new AgentOutputError(
      `브리프의 "모드"는 ${SURFACE_MODES.join(" 또는 ")}여야 해요.`,
    );
  return {
    mode,
    audience: text(brief, "대상", 300),
    outcome: text(brief, "과업", 300),
    direction: text(brief, "방향", 600),
    layout: text(brief, "레이아웃", 600),
    antiGoals: list(brief, "피할것", 1, 5),
    assumptions: list(brief, "가정", 0, 6),
  };
}

/** 문서 연결 규칙을 어기면 형식 오류처럼 알려 한 번 고칠 기회를 준다. */
export function assertNoProblems(problems: { message: string }[]) {
  if (problems.length)
    throw new AgentOutputError(
      `문서 연결 오류: ${problems.map((p) => p.message).join(" ")}`,
    );
}

const compact = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * 근거 문장이 대표가 입력한 내용에 실제로 있으면 정리한 인용문을, 없으면 null.
 * 모델이 만든 범위 정리는 근거로 보지 않는다.
 */
export function quoteFromCeoInput(
  c: AgentContext,
  evidence: unknown,
): string | null {
  if (typeof evidence !== "string") return null;
  const quote = compact(evidence).replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "");
  if (quote.length < 2) return null;
  const inputs = [c.idea, c.purpose ?? "", c.constraints ?? "", ...c.feedback];
  return inputs.some((input) => compact(input).includes(quote)) ? quote : null;
}

/** 회의 발언 목록. 참석자만 말할 수 있다. */
export function statements(
  o: Obj,
  participants: RoleId[],
  min: number,
  max: number,
): MeetingBeat[] {
  const raw = o["발언"];
  if (!Array.isArray(raw) || raw.length < min || raw.length > max)
    throw new AgentOutputError(`"발언"은 ${min}~${max}개여야 해요.`);
  return raw.map((item) => {
    const entry = (item ?? {}) as Obj;
    const role = entry["역할"];
    if (!participants.includes(role as RoleId))
      throw new AgentOutputError(
        `참석자가 아닌 역할이 말했어요: ${String(role)}`,
      );
    return {
      kind: "STATEMENT",
      role: role as RoleId,
      summary: text(entry, "내용", 160),
    };
  });
}

export function parseFiles(o: Obj): SourceFileInput[] {
  // 수정 입력은 path/content를 사용하므로 같은 의미의 영문 키도 받는다.
  // 두 형식이 섞여 충돌하면 임의로 하나를 선택하지 않는다.
  const raw = sourceField(o, "파일", "files");
  if (raw === undefined)
    throw new AgentOutputError(
      '최상위 "파일" 항목이 없어요. {"파일":[{"경로":"상대 경로","내용":"전체 소스"}]} 구조로 출력하세요.',
    );
  if (!Array.isArray(raw))
    throw new AgentOutputError(
      '"파일"은 객체나 문자열이 아닌 배열이어야 해요.',
    );
  if (raw.length === 0 || raw.length > 60)
    throw new AgentOutputError(
      `"파일"은 1~60개여야 해요. 현재 ${raw.length}개예요.`,
    );
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new AgentOutputError(`파일 ${index + 1}번째 항목은 객체여야 해요.`);
    const entry = {
      경로: sourceField(item, "경로", "path"),
      내용: sourceField(item, "내용", "content"),
    };
    const path = text(entry, "경로", 200);
    const content = entry["내용"];
    if (typeof content !== "string")
      throw new AgentOutputError(`${path}: "내용"이 문자열이 아니에요.`);
    if (seen.has(path)) throw new AgentOutputError(`${path}: 경로가 중복돼요.`);
    seen.add(path);
    return { path, content };
  });
}

function sourceField(obj: Obj, key: string, alias: string): unknown {
  if (Object.hasOwn(obj, key) && Object.hasOwn(obj, alias))
    throw new AgentOutputError(`"${key}"와 "${alias}" 중 하나만 사용하세요.`);
  return Object.hasOwn(obj, key) ? obj[key] : obj[alias];
}

export function parsePlanOutput(
  o: Obj,
  c: AgentContext,
  previousPlan: DataPlan | null,
): Record<string, string> {
  if (o["인증필요"] === true) {
    // 추측으로 멈추지 않도록, 대표가 직접 쓴 요구 문장을 근거로 인용해야 중단한다.
    const quote = quoteFromCeoInput(c, o["인증근거"]);
    if (!quote)
      throw new AgentOutputError(
        "인증필요가 true이면 \"인증근거\"에 대표 입력(아이디어·목적·제약·수정 요청)에서 로그인·계정·비공개를 직접 요구한 문장을 그대로 옮겨야 해요. 그런 문장이 없으면 인증필요는 false입니다. '개인용', '내 기록' 같은 표현은 근거가 아닙니다.",
      );
    throw new UnsupportedAuthenticationError(quote);
  }
  if (o["인증필요"] !== false)
    throw new AgentOutputError(
      '"인증필요"는 true 또는 false로 명시해야 해요. 요구를 생략하지 말고 판단하세요.',
    );
  const requirements = objects(o, "기능", 1, 10).map(parseRequirement);
  const criteria = objects(o, "완료조건", 1, 15).map(parseCriterion);
  const need = o["데이터저장"];
  if (need !== "필요" && need !== "불필요")
    throw new AgentOutputError('"데이터저장"은 "필요" 또는 "불필요"여야 해요.');
  // 이미 DB가 있는 앱은 저장을 없앨 수 없다(기존 데이터 보존).
  if (need === "불필요" && previousPlan)
    throw new AgentOutputError(
      '이미 DB를 쓰는 앱이라 데이터저장은 "필요"여야 해요.',
    );
  let data: DataPlan | null = null;
  if (need === "필요") {
    try {
      data = parseDataPlan(o["데이터계획"]);
    } catch (error) {
      if (error instanceof UnsupportedDataAccessError) throw error;
      if (error instanceof DataPlanError)
        throw new AgentOutputError(`데이터계획: ${error.message}`);
      throw error;
    }
  }
  const doc: ProductPlanDocument = {
    purpose: text(o, "목적"),
    inScope: list(o, "포함범위", 1, 6),
    outOfScope: list(o, "제외범위", 0, 6),
    requirements,
    criteria,
    data: { description: text(o, "데이터"), plan: data },
  };
  assertNoProblems(planProblems(doc));
  return renderPlan(doc);
}

export function parseDesignOutput(
  o: Obj,
  plan: ProductPlanDocument,
  guide: DesignGuide | null,
): Record<string, string> {
  const doc: ScreenDesignDocument = {
    brief: parseBrief(o),
    screens: objects(o, "화면", 1, 3).map(parseScreen),
    navigation: text(o, "연결"),
    guide: guide ? `${guide.name} ${guide.version}` : null,
  };
  assertNoProblems(designProblems(plan, doc));
  return renderDesign(doc);
}

export function parseReviewOutput(
  o: Obj,
  topic: string,
  participants: RoleId[],
  hasDesign: boolean,
): { script: MeetingScript; issues: ReviewIssue[] } {
  const beats = statements(o, participants, 4, 8);
  const raw = o["문제"] ?? [];
  if (!Array.isArray(raw) || raw.length > 5)
    throw new AgentOutputError('"문제"는 0~5개 배열이어야 해요.');
  const issues = raw.map((item): ReviewIssue => {
    const entry = (item ?? {}) as Obj;
    const target =
      entry["대상"] === "기획"
        ? "PRODUCT_SPEC"
        : entry["대상"] === "화면" && hasDesign
          ? "SCREEN_PLAN"
          : null;
    if (!target)
      throw new AgentOutputError(
        `문제의 "대상"이 올바르지 않아요: ${String(entry["대상"])}`,
      );
    return {
      target,
      problem: text(entry, "문제", 200),
      resolution: text(entry, "해결조건", 200),
    };
  });
  return { script: { topic, beats }, issues };
}
