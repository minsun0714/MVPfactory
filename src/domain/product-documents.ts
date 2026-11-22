/**
 * 생성 앱의 제품 기획·화면 설계 문서와 그 연결 규칙.
 *
 * - 기능(APP-REQ)·완료 조건(APP-AC)·화면(SCR)에 ID를 붙여, 문장 속 단어가 아니라 ID 연결로 누락을 검사한다.
 * - 기능이 쓰는 데이터 동작(테이블·동작)을 선언하게 하고, 데이터 계획의 허용 동작과 맞는지 검사한다.
 * - 산출물(Artifact)은 사람이 읽는 문장 항목과 구조(`ARTIFACT_STRUCTURE_KEY`)를 함께 저장한다.
 *   문장 항목은 항상 구조에서 만들므로 둘이 달라지지 않는다.
 *
 * 프레임워크·저장소·모델을 모른다.
 */
import {
  ARTIFACT_LIST_SEPARATOR,
  ARTIFACT_STRUCTURE_KEY,
} from "@/contracts/runs";
import {
  ACCESS_ACTIONS,
  SPEC_DATA_NEED,
  SPEC_DATA_PLAN,
  parseDataPlan,
  type AccessAction,
  type DataPlan,
} from "@/domain/data-plan";

export const REQUIREMENT_ID = /^APP-REQ-\d{3}$/;
export const CRITERION_ID = /^APP-AC-\d{3}$/;
export const SCREEN_ID = /^SCR-\d{3}$/;

export const PLAN_LIMITS = {
  requirements: { min: 2, max: 6 },
  criteria: { min: 3, max: 12 },
  screens: { min: 1, max: 3 },
} as const;

export type DataUse = { table: string; action: AccessAction };

export type Requirement = {
  id: string;
  name: string;
  /** 사용자가 이 기능을 쓰는 순서 */
  flow: string[];
  /** 이 기능이 쓰는 데이터 동작. 데이터를 쓰지 않으면 빈 배열 */
  dataUses: DataUse[];
};

export type Criterion = {
  id: string;
  requirementId: string;
  /** 배포된 화면에서 직접 확인할 수 있는 문장 */
  statement: string;
};

export type ProductPlanDocument = {
  purpose: string;
  inScope: string[];
  outOfScope: string[];
  requirements: Requirement[];
  criteria: Criterion[];
  data: { description: string; plan: DataPlan | null };
};

export type Screen = {
  id: string;
  name: string;
  requirementIds: string[];
  /** 이 화면에서 가장 중요한 한 가지 행동 */
  primaryAction: string;
  actions: string[];
  states: { normal: string; empty: string; loading: string; error: string };
};

/** 생성 앱은 작업 도구이므로 Operate가 기본이다. 읽기 중심 화면만 Read다. */
export const SURFACE_MODES = ["Operate", "Read"] as const;
export type SurfaceMode = (typeof SURFACE_MODES)[number];

/** 디자인 지침의 브리프(대상·과업·방향·범위·가정). CSS 값이 아니라 의도를 쓴다. */
export type DesignBrief = {
  mode: SurfaceMode;
  audience: string;
  outcome: string;
  direction: string;
  layout: string;
  antiGoals: string[];
  assumptions: string[];
};

export type ScreenDesignDocument = {
  brief: DesignBrief;
  screens: Screen[];
  navigation: string;
  /** 설계에 쓴 디자인 지침(예: "Impeccable 4.10.0"). 지침 없이 썼으면 null */
  guide: string | null;
};

/** 문서가 고칠 대상. 산출물 종류와 같은 이름을 쓴다. */
export type DocumentTarget = "PRODUCT_SPEC" | "SCREEN_PLAN";

export type DocumentProblem = { target: DocumentTarget; message: string };

const ACTION_LABELS: Record<AccessAction, string> = {
  read: "조회",
  insert: "추가",
  update: "수정",
  delete: "삭제",
};

function duplicates(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

/** 기획 문서 안의 연결 규칙. 문제가 없으면 빈 배열 */
export function planProblems(doc: ProductPlanDocument): DocumentProblem[] {
  const problems: string[] = [];
  const { requirements, criteria } = doc;
  const { min: reqMin, max: reqMax } = PLAN_LIMITS.requirements;
  const { min: acMin, max: acMax } = PLAN_LIMITS.criteria;
  if (requirements.length < reqMin || requirements.length > reqMax)
    problems.push(`기능은 ${reqMin}~${reqMax}개여야 해요.`);
  if (criteria.length < acMin || criteria.length > acMax)
    problems.push(`완료 조건은 ${acMin}~${acMax}개여야 해요.`);
  for (const r of requirements)
    if (!REQUIREMENT_ID.test(r.id))
      problems.push(
        `기능 ID 형식이 틀렸어요(${r.id}). APP-REQ-001 형식으로 쓰세요.`,
      );
  for (const c of criteria)
    if (!CRITERION_ID.test(c.id))
      problems.push(
        `완료 조건 ID 형식이 틀렸어요(${c.id}). APP-AC-001 형식으로 쓰세요.`,
      );
  for (const id of duplicates(requirements.map((r) => r.id)))
    problems.push(`중복된 기능 ID: ${id}`);
  for (const id of duplicates(criteria.map((c) => c.id)))
    problems.push(`중복된 완료 조건 ID: ${id}`);

  const reqIds = new Set(requirements.map((r) => r.id));
  for (const c of criteria)
    if (!reqIds.has(c.requirementId))
      problems.push(
        `완료 조건 ${c.id}에 적힌 기능 ID가 기획에 없어요: ${c.requirementId}`,
      );
  for (const r of requirements)
    if (!criteria.some((c) => c.requirementId === r.id))
      problems.push(`완료 조건이 없는 기능: ${r.id} ${r.name}`);

  const plan = doc.data.plan;
  const used = new Set<string>();
  for (const r of requirements)
    for (const use of r.dataUses) {
      used.add(use.table);
      const table = plan?.tables.find((t) => t.name === use.table);
      if (!plan)
        problems.push(
          `기능 ${r.id}에서 ${use.table} 데이터를 쓰는데 데이터 저장이 "불필요"예요.`,
        );
      else if (!table)
        problems.push(
          `기능 ${r.id}에서 데이터 계획에 없는 테이블을 써요: ${use.table}`,
        );
      else if (!table.access[use.action])
        problems.push(
          `기능 ${r.id}에서 ${use.table}의 ${ACTION_LABELS[use.action]} 동작을 쓰는데 데이터 계획이 허용하지 않아요(access.${use.action}: false). 기능을 바꾸거나, 로그인 없이 공개해도 되는 동작일 때만 허용하세요.`,
        );
    }
  for (const table of plan?.tables ?? [])
    if (!used.has(table.name))
      problems.push(`어떤 기능도 쓰지 않는 테이블: ${table.name}`);

  return problems.map((message) => ({ target: "PRODUCT_SPEC", message }));
}

/** 화면 설계와 기획의 연결 규칙. 문제가 없으면 빈 배열 */
export function designProblems(
  plan: ProductPlanDocument,
  design: ScreenDesignDocument,
): DocumentProblem[] {
  const problems: string[] = [];
  const { min, max } = PLAN_LIMITS.screens;
  if (design.screens.length < min || design.screens.length > max)
    problems.push(`화면은 ${min}~${max}개여야 해요.`);
  for (const s of design.screens)
    if (!SCREEN_ID.test(s.id))
      problems.push(
        `화면 ID 형식이 틀렸어요(${s.id}). SCR-001 형식으로 쓰세요.`,
      );
  for (const id of duplicates(design.screens.map((s) => s.id)))
    problems.push(`중복된 화면 ID: ${id}`);
  const reqIds = new Set(plan.requirements.map((r) => r.id));
  for (const s of design.screens) {
    if (s.requirementIds.length === 0)
      problems.push(`연결된 기능이 없는 화면: ${s.id} ${s.name}`);
    for (const id of s.requirementIds)
      if (!reqIds.has(id))
        problems.push(`화면 ${s.id}에 적힌 기능 ID가 기획에 없어요: ${id}`);
  }
  for (const r of plan.requirements)
    if (!design.screens.some((s) => s.requirementIds.includes(r.id)))
      problems.push(`다루는 화면이 없는 기능: ${r.id} ${r.name}`);
  return problems.map((message) => ({ target: "SCREEN_PLAN", message }));
}

/**
 * 로그인 없는 앱에서 누가 무엇을 할 수 있는지. 모델의 설명이 아니라 데이터 계획의 허용 동작으로 만든다.
 * 대표가 데이터 공개 범위를 모르고 승인하지 않게 기획 문서와 결정 제안에 그대로 보여 준다.
 */
export function publicAccessSummary(plan: DataPlan | null): string {
  if (!plan || plan.tables.length === 0)
    return "서버에 저장하는 데이터가 없어요.";
  const tables = plan.tables.map((t) => {
    const allowed = ACCESS_ACTIONS.filter((a) => t.access[a]).map(
      (a) => ACTION_LABELS[a],
    );
    return `${t.name} ${allowed.join("·") || "접근 없음"}`;
  });
  return `로그인이 없어 앱 주소를 아는 누구나 이 데이터를 쓸 수 있어요: ${tables.join(", ")}`;
}

/** 기획 산출물에 공개 범위를 담는 키 */
export const SPEC_PUBLIC_ACCESS = "공개 범위";

// ── 산출물 문장 항목 ↔ 구조

const join = (items: string[]) => items.join(ARTIFACT_LIST_SEPARATOR);

/** 기획 문서를 산출물 내용으로 바꾼다. 문장 항목은 모두 구조에서 만든다. */
export function renderPlan(doc: ProductPlanDocument): Record<string, string> {
  const content: Record<string, string> = {
    "인증 필요": "불필요",
    목적: doc.purpose,
    "포함 범위": join(doc.inScope),
    "제외 범위": join(doc.outOfScope),
    "핵심 기능": join(doc.requirements.map((r) => `${r.id} ${r.name}`)),
    "사용자 흐름": join(
      doc.requirements.map((r) => `${r.id}: ${r.flow.join(" → ")}`),
    ),
    "완료 조건": join(
      doc.criteria.map((c) => `${c.id}(${c.requirementId}) ${c.statement}`),
    ),
    데이터: doc.data.description,
    [SPEC_DATA_NEED]: doc.data.plan ? "필요" : "불필요",
    [SPEC_PUBLIC_ACCESS]: publicAccessSummary(doc.data.plan),
  };
  if (doc.data.plan) content[SPEC_DATA_PLAN] = JSON.stringify(doc.data.plan);
  content[ARTIFACT_STRUCTURE_KEY] = JSON.stringify(doc);
  return content;
}

export function renderDesign(
  doc: ScreenDesignDocument,
): Record<string, string> {
  const { brief } = doc;
  return {
    "대상과 상황": brief.audience,
    "화면 모드": brief.mode,
    "핵심 과업": brief.outcome,
    "디자인 방향": brief.direction,
    "레이아웃·상호작용": brief.layout,
    "피할 것": join(brief.antiGoals),
    가정: brief.assumptions.length ? join(brief.assumptions) : "없음",
    화면: join(doc.screens.map((s) => `${s.id} ${s.name}`)),
    "화면별 기능": join(
      doc.screens.map((s) => `${s.id}: ${s.requirementIds.join(", ")}`),
    ),
    "화면별 주 행동": join(
      doc.screens.map((s) => `${s.id}: ${s.primaryAction}`),
    ),
    "사용자 행동": join(
      doc.screens.map((s) => `${s.id}: ${s.actions.join(", ")}`),
    ),
    상태: join(
      doc.screens.map(
        (s) =>
          `${s.id} 정상: ${s.states.normal} / 빈 상태: ${s.states.empty} / 불러오는 중: ${s.states.loading} / 오류: ${s.states.error}`,
      ),
    ),
    연결: doc.navigation,
    "디자인 지침": doc.guide ?? "없음",
    [ARTIFACT_STRUCTURE_KEY]: JSON.stringify(doc),
  };
}

// 저장된 구조는 이전 버전이나 데모 산출물일 수 있으므로 형식을 다시 확인한다.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function structureOf(content: Record<string, string>): Obj | null {
  const raw = content[ARTIFACT_STRUCTURE_KEY];
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

/** 산출물에 저장된 기획 구조. 구조가 없는(데모·이전 형식) 산출물이면 null */
export function readPlan(
  content: Record<string, string>,
): ProductPlanDocument | null {
  const o = structureOf(content);
  if (!o || !isStr(o.purpose) || !strs(o.inScope) || !strs(o.outOfScope))
    return null;
  if (!Array.isArray(o.requirements) || !Array.isArray(o.criteria)) return null;
  if (!isObj(o.data) || !isStr(o.data.description)) return null;
  const requirements: Requirement[] = [];
  for (const r of o.requirements) {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.name) || !strs(r.flow))
      return null;
    if (!Array.isArray(r.dataUses)) return null;
    const dataUses: DataUse[] = [];
    for (const u of r.dataUses) {
      if (!isObj(u) || !isStr(u.table)) return null;
      const action = ACCESS_ACTIONS.find((a) => a === u.action);
      if (!action) return null;
      dataUses.push({ table: u.table, action });
    }
    requirements.push({ id: r.id, name: r.name, flow: r.flow, dataUses });
  }
  const criteria: Criterion[] = [];
  for (const c of o.criteria) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.requirementId)) return null;
    if (!isStr(c.statement)) return null;
    criteria.push({
      id: c.id,
      requirementId: c.requirementId,
      statement: c.statement,
    });
  }
  let plan: DataPlan | null = null;
  if (o.data.plan !== null && o.data.plan !== undefined) {
    try {
      plan = parseDataPlan(o.data.plan);
    } catch {
      return null;
    }
  }
  return {
    purpose: o.purpose,
    inScope: o.inScope,
    outOfScope: o.outOfScope,
    requirements,
    criteria,
    data: { description: o.data.description, plan },
  };
}

export function readDesign(
  content: Record<string, string>,
): ScreenDesignDocument | null {
  const o = structureOf(content);
  if (!o || !Array.isArray(o.screens) || !isStr(o.navigation)) return null;
  if (o.guide !== null && !isStr(o.guide)) return null;
  const b = o.brief;
  if (!isObj(b)) return null;
  const mode = SURFACE_MODES.find((m) => m === b.mode);
  if (!mode || !strs(b.antiGoals) || !strs(b.assumptions)) return null;
  const { audience, outcome, direction, layout } = b;
  if (!isStr(audience) || !isStr(outcome)) return null;
  if (!isStr(direction) || !isStr(layout)) return null;
  const screens: Screen[] = [];
  for (const s of o.screens) {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.name)) return null;
    if (!isStr(s.primaryAction)) return null;
    if (!strs(s.requirementIds) || !strs(s.actions) || !isObj(s.states))
      return null;
    const { normal, empty, loading, error } = s.states;
    if (!isStr(normal) || !isStr(empty)) return null;
    if (!isStr(loading) || !isStr(error)) return null;
    screens.push({
      id: s.id,
      name: s.name,
      requirementIds: s.requirementIds,
      primaryAction: s.primaryAction,
      actions: s.actions,
      states: { normal, empty, loading, error },
    });
  }
  return {
    brief: {
      mode,
      audience,
      outcome,
      direction,
      layout,
      antiGoals: b.antiGoals,
      assumptions: b.assumptions,
    },
    screens,
    navigation: o.navigation,
    guide: isStr(o.guide) ? o.guide : null,
  };
}

// ── 확정 사양(ProductSpec.content)

/** 확정 사양에 기획·화면 산출물 내용을 담는 키 */
export const CONFIRMED_SPEC_KEYS = { plan: "기획", screens: "화면" } as const;

const stringRecord = (value: unknown): Record<string, string> | null =>
  isObj(value) && Object.values(value).every(isStr)
    ? (value as Record<string, string>)
    : null;

/** 확정 사양에서 기획·화면 산출물 내용을 꺼낸다. 형식이 맞지 않으면 null */
export function readConfirmedSpec(
  content: Record<string, unknown>,
): { spec: Record<string, string>; screens: Record<string, string> } | null {
  const spec = stringRecord(content[CONFIRMED_SPEC_KEYS.plan]);
  const screens = stringRecord(content[CONFIRMED_SPEC_KEYS.screens]);
  return spec && screens ? { spec, screens } : null;
}
