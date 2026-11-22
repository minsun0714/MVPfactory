/**
 * 확정한 제품 문서를 생성 앱 저장소의 Markdown 파일로 만든다.
 *
 * 파일은 DB에 확정 저장한 구조에서만 만든다(파일을 따로 작성하지 않는다). 개발자 에이전트에게는 읽기 전용
 * 참고 자료로 주고, 결과 소스에는 이 내용을 그대로 다시 넣어 저장소 문서와 확정 사양이 어긋나지 않게 한다.
 */
import {
  publicAccessSummary,
  readDesign,
  readPlan,
  type ProductPlanDocument,
  type ScreenDesignDocument,
} from "@/domain/product-documents";
import type { SourceFileInput } from "@/domain/sandbox";
import { ARTIFACT_STRUCTURE_KEY } from "@/contracts/runs";

export const DOCUMENT_PATHS = {
  prd: "docs/PRD.md",
  design: "docs/DESIGN.md",
  implementation: "docs/IMPLEMENTATION.md",
  verification: "docs/VERIFICATION.md",
} as const;

export const DOCUMENT_PATH_LIST: string[] = Object.values(DOCUMENT_PATHS);

const ACTION_LABELS = {
  read: "조회",
  insert: "추가",
  update: "수정",
  delete: "삭제",
} as const;

// 표 칸 안의 줄바꿈·세로선은 Markdown 표를 깨뜨린다.
const cell = (value: string) =>
  value.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
const bullets = (items: string[]) =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : "- 없음";

function header(title: string, specVersion: number): string {
  return [
    `# ${title}`,
    "",
    `> 확정 사양 버전 ${specVersion}. MVP 팩토리가 확정 사양에서 자동으로 만든 문서입니다. 직접 수정하지 마세요.`,
    "",
  ].join("\n");
}

function prd(plan: ProductPlanDocument, version: number): string {
  const tables = plan.data.plan?.tables ?? [];
  return [
    header("제품 요구사항", version),
    "## 목적",
    "",
    plan.purpose,
    "",
    "## 범위",
    "",
    "포함:",
    "",
    bullets(plan.inScope),
    "",
    "제외:",
    "",
    bullets(plan.outOfScope),
    "",
    "## 인증과 공개 범위",
    "",
    "로그인·회원가입 없이 이용하는 앱입니다.",
    "",
    publicAccessSummary(plan.data.plan),
    "",
    "## 기능",
    "",
    ...plan.requirements.flatMap((r) => [
      `### ${r.id} ${r.name}`,
      "",
      "사용자 흐름:",
      "",
      r.flow.map((step, i) => `${i + 1}. ${step}`).join("\n"),
      "",
      `데이터: ${
        r.dataUses.length
          ? r.dataUses
              .map((u) => `${u.table} ${ACTION_LABELS[u.action]}`)
              .join(", ")
          : "사용하지 않음"
      }`,
      "",
    ]),
    "## 데이터",
    "",
    plan.data.description,
    "",
    ...(tables.length
      ? tables.flatMap((t) => [
          `### ${t.name}`,
          "",
          "| 필드 | 형식 | 필수 |",
          "| --- | --- | --- |",
          ...t.fields.map(
            (f) =>
              `| ${f.name} | ${f.type} | ${f.required ? "필수" : "선택"} |`,
          ),
          "",
          `로그인 없이 허용하는 동작: ${
            (Object.keys(ACTION_LABELS) as (keyof typeof ACTION_LABELS)[])
              .filter((a) => t.access[a])
              .map((a) => ACTION_LABELS[a])
              .join(", ") || "없음"
          }`,
          "",
        ])
      : ["데이터를 서버에 저장하지 않습니다.", ""]),
    "## 완료 조건",
    "",
    "| ID | 기능 | 확인할 내용 |",
    "| --- | --- | --- |",
    ...plan.criteria.map(
      (c) => `| ${c.id} | ${c.requirementId} | ${cell(c.statement)} |`,
    ),
    "",
  ].join("\n");
}

function design(doc: ScreenDesignDocument, version: number): string {
  const { brief } = doc;
  return [
    header("화면 설계", version),
    "## 디자인 브리프",
    "",
    `디자인 지침: ${doc.guide ?? "없음"}`,
    "",
    `- 화면 모드: ${brief.mode}`,
    `- 대상과 상황: ${brief.audience}`,
    `- 핵심 과업과 성공: ${brief.outcome}`,
    `- 디자인 방향: ${brief.direction}`,
    `- 레이아웃·상호작용: ${brief.layout}`,
    "",
    "피할 것:",
    "",
    bullets(brief.antiGoals),
    "",
    "디자이너가 세운 가정(대표 확인 전):",
    "",
    bullets(brief.assumptions),
    "",
    ...doc.screens.flatMap((s) => [
      `## ${s.id} ${s.name}`,
      "",
      `연결된 기능: ${s.requirementIds.join(", ")}`,
      "",
      `주 행동: ${s.primaryAction}`,
      "",
      "사용자 행동:",
      "",
      bullets(s.actions),
      "",
      "| 상태 | 화면에 보이는 것 |",
      "| --- | --- |",
      `| 정상 | ${cell(s.states.normal)} |`,
      `| 빈 상태 | ${cell(s.states.empty)} |`,
      `| 불러오는 중 | ${cell(s.states.loading)} |`,
      `| 오류 | ${cell(s.states.error)} |`,
      "",
    ]),
    "## 화면 사이 이동",
    "",
    doc.navigation,
    "",
  ].join("\n");
}

function implementation(
  plan: ProductPlanDocument,
  doc: ScreenDesignDocument,
  version: number,
): string {
  const env = plan.data.plan
    ? [
        "- `NEXT_PUBLIC_SUPABASE_URL`",
        "- `NEXT_PUBLIC_SUPABASE_ANON_KEY`",
        "- `NEXT_PUBLIC_SUPABASE_SCHEMA`",
        "",
        "값은 배포 환경에 팩토리가 넣습니다. 소스에 값을 쓰지 않습니다.",
      ].join("\n")
    : "없음. 외부 서비스를 호출하지 않습니다.";
  return [
    header("구현 작업", version),
    "기술: Next.js(App Router), TypeScript, Vitest.",
    "",
    "| 기능 | 구현 화면 | 데이터 | 완료 조건 |",
    "| --- | --- | --- | --- |",
    ...plan.requirements.map((r) => {
      const screens = doc.screens
        .filter((s) => s.requirementIds.includes(r.id))
        .map((s) => `${s.id} ${s.name}`)
        .join(", ");
      const data =
        r.dataUses
          .map((u) => `${u.table} ${ACTION_LABELS[u.action]}`)
          .join(", ") || "-";
      const criteria = plan.criteria
        .filter((c) => c.requirementId === r.id)
        .map((c) => c.id)
        .join(", ");
      return `| ${r.id} ${cell(r.name)} | ${cell(screens)} | ${data} | ${criteria} |`;
    }),
    "",
    "## 필요한 외부 설정",
    "",
    env,
    "",
  ].join("\n");
}

function verification(plan: ProductPlanDocument, version: number): string {
  return [
    header("검증 계획", version),
    "빌드와 단위 테스트는 팩토리의 격리 환경에서 실행합니다. 아래 완료 조건은 배포된 앱에서 확인해야 하며, 자동 브라우저 검증은 아직 연결되지 않았습니다.",
    "",
    "| ID | 기능 | 확인할 내용 | 확인 방법 | 결과 |",
    "| --- | --- | --- | --- | --- |",
    ...plan.criteria.map(
      (c) =>
        `| ${c.id} | ${c.requirementId} | ${cell(c.statement)} | 배포된 앱에서 화면으로 확인 | 검증 전 |`,
    ),
    "",
  ].join("\n");
}

/** 구조가 없는(데모·이전 형식) 산출물도 확정 내용을 잃지 않도록 항목을 그대로 적는다. */
function plainDocument(
  title: string,
  content: Record<string, string>,
  version: number,
): string {
  return [
    header(title, version),
    ...Object.entries(content)
      .filter(([key]) => key !== ARTIFACT_STRUCTURE_KEY)
      .flatMap(([key, value]) => [`## ${key}`, "", value, ""]),
  ].join("\n");
}

/** 확정 사양에서 생성 앱 저장소의 문서 파일을 만든다. */
export function documentFiles(input: {
  specVersion: number;
  spec: Record<string, string>;
  screens: Record<string, string>;
}): SourceFileInput[] {
  const version = input.specVersion;
  const plan = readPlan(input.spec);
  const screens = readDesign(input.screens);
  if (!plan || !screens)
    return [
      {
        path: DOCUMENT_PATHS.prd,
        content: plainDocument("제품 요구사항", input.spec, version),
      },
      {
        path: DOCUMENT_PATHS.design,
        content: plainDocument("화면 설계", input.screens, version),
      },
    ];
  return [
    { path: DOCUMENT_PATHS.prd, content: prd(plan, version) },
    { path: DOCUMENT_PATHS.design, content: design(screens, version) },
    {
      path: DOCUMENT_PATHS.implementation,
      content: implementation(plan, screens, version),
    },
    { path: DOCUMENT_PATHS.verification, content: verification(plan, version) },
  ];
}

/**
 * 개발자가 만든 소스에 확정 문서를 넣는다. 개발자가 문서를 고치거나 지웠어도 확정본으로 되돌린다.
 */
export function withDocuments(
  files: SourceFileInput[],
  documents: SourceFileInput[],
): SourceFileInput[] {
  const managed = new Set(DOCUMENT_PATH_LIST);
  return [...files.filter((file) => !managed.has(file.path)), ...documents];
}
