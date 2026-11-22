import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  designProblems,
  planProblems,
  publicAccessSummary,
  readConfirmedSpec,
  readDesign,
  readPlan,
  renderDesign,
  renderPlan,
  type ProductPlanDocument,
  type ScreenDesignDocument,
} from "@/domain/product-documents";
import {
  DOCUMENT_PATHS,
  documentFiles,
  withDocuments,
} from "@/domain/product-document-files";

const COUPONS: ProductPlanDocument = {
  purpose: "쿠폰 만료일을 한곳에서 확인",
  inScope: ["쿠폰 등록", "만료일 순 목록"],
  outOfScope: ["로그인"],
  requirements: [
    {
      id: "APP-REQ-001",
      name: "쿠폰 등록",
      flow: ["브랜드·쿠폰명·만료일 입력", "저장"],
      dataUses: [{ table: "coupons", action: "insert" }],
    },
    {
      id: "APP-REQ-002",
      name: "만료일 순 목록",
      flow: ["목록을 연다"],
      dataUses: [{ table: "coupons", action: "read" }],
    },
  ],
  criteria: [
    {
      id: "APP-AC-001",
      requirementId: "APP-REQ-001",
      statement: "저장하면 목록에 보인다",
    },
    {
      id: "APP-AC-002",
      requirementId: "APP-REQ-002",
      statement: "만료일 빠른 순으로 보인다",
    },
    {
      id: "APP-AC-003",
      requirementId: "APP-REQ-002",
      statement: "임박 표시가 보인다 | 강조",
    },
  ],
  data: {
    description: "브랜드명, 쿠폰명, 만료일",
    plan: {
      tables: [
        {
          name: "coupons",
          fields: [{ name: "brand_name", type: "text", required: true }],
          access: { read: true, insert: true, update: false, delete: false },
        },
      ],
    },
  },
};

const SCREENS: ScreenDesignDocument = {
  brief: {
    mode: "Operate",
    audience: "카페 쿠폰을 모으는 사람",
    outcome: "만료 전에 쓸 쿠폰을 찾는다",
    direction: "차분한 중립색, 만료 임박만 강조",
    layout: "목록 위 추가 버튼, 모바일 한 열",
    antiGoals: ["장식용 애니메이션"],
    assumptions: ["쿠폰은 수십 개 이하"],
  },
  guide: "Impeccable 4.10.0",
  screens: [
    {
      id: "SCR-001",
      name: "쿠폰 목록",
      requirementIds: ["APP-REQ-001", "APP-REQ-002"],
      primaryAction: "쿠폰 추가",
      actions: ["쿠폰 추가", "목록 확인"],
      states: {
        normal: "목록",
        empty: "첫 쿠폰을 추가하세요",
        loading: "목록 자리 스켈레톤",
        error: "다시 시도",
      },
    },
  ],
  navigation: "한 화면",
};

const messages = (problems: { message: string }[]) =>
  problems.map((p) => p.message);

test("연결이 맞는 문서는 문제가 없다", () => {
  assert.deepEqual(planProblems(COUPONS), []);
  assert.deepEqual(designProblems(COUPONS, SCREENS), []);
});

test("쿠폰 앱처럼 기능이 허용되지 않은 수정·삭제를 쓰면 기획 문제로 잡는다", () => {
  const doc: ProductPlanDocument = {
    ...COUPONS,
    requirements: [
      ...COUPONS.requirements,
      {
        id: "APP-REQ-003",
        name: "쿠폰 수정·삭제",
        flow: ["쿠폰 선택", "수정 또는 삭제"],
        dataUses: [
          { table: "coupons", action: "update" },
          { table: "coupons", action: "delete" },
        ],
      },
    ],
    criteria: [
      ...COUPONS.criteria,
      {
        id: "APP-AC-004",
        requirementId: "APP-REQ-003",
        statement: "수정하면 반영된다",
      },
    ],
  };
  const problems = planProblems(doc);
  assert.ok(problems.every((p) => p.target === "PRODUCT_SPEC"));
  assert.deepEqual(
    messages(problems).map((m) => m.match(/access\.\w+/)?.[0]),
    ["access.update", "access.delete"],
  );
});

test("데이터 저장이 불필요한데 데이터를 쓰거나, 아무도 쓰지 않는 테이블이 있으면 문제다", () => {
  assert.match(
    messages(
      planProblems({ ...COUPONS, data: { description: "x", plan: null } }),
    )[0],
    /데이터 저장이 "불필요"/,
  );
  const unused = planProblems({
    ...COUPONS,
    requirements: COUPONS.requirements.map((r) => ({ ...r, dataUses: [] })),
  });
  assert.deepEqual(messages(unused), ["어떤 기능도 쓰지 않는 테이블: coupons"]);
});

test("ID 형식·중복과 완료 조건 연결을 검사한다", () => {
  const problems = messages(
    planProblems({
      ...COUPONS,
      requirements: [
        COUPONS.requirements[0],
        { ...COUPONS.requirements[1], id: "REQ-2" },
      ],
      criteria: [...COUPONS.criteria, { ...COUPONS.criteria[0] }],
    }),
  );
  assert.ok(
    problems.includes(
      "기능 ID 형식이 틀렸어요(REQ-2). APP-REQ-001 형식으로 쓰세요.",
    ),
  );
  assert.ok(problems.includes("중복된 완료 조건 ID: APP-AC-001"));
  assert.ok(
    problems.includes(
      "완료 조건 APP-AC-002에 적힌 기능 ID가 기획에 없어요: APP-REQ-002",
    ),
  );
});

test("화면이 없는 기능, 기획에 없는 기능을 가리키는 화면을 화면 문제로 잡는다", () => {
  const problems = designProblems(COUPONS, {
    ...SCREENS,
    screens: [
      { ...SCREENS.screens[0], requirementIds: ["APP-REQ-001", "APP-REQ-009"] },
    ],
  });
  assert.ok(problems.every((p) => p.target === "SCREEN_PLAN"));
  assert.deepEqual(messages(problems), [
    "화면 SCR-001에 적힌 기능 ID가 기획에 없어요: APP-REQ-009",
    "다루는 화면이 없는 기능: APP-REQ-002 만료일 순 목록",
  ]);
});

test("산출물 문장 항목은 구조에서 만들고, 저장된 구조를 다시 읽을 수 있다", () => {
  const spec = renderPlan(COUPONS);
  assert.equal(
    spec["핵심 기능"],
    "APP-REQ-001 쿠폰 등록 · APP-REQ-002 만료일 순 목록",
  );
  assert.equal(spec["데이터 저장"], "필요");
  assert.deepEqual(readPlan(spec), COUPONS);
  assert.deepEqual(readDesign(renderDesign(SCREENS)), SCREENS);
  // 데모·이전 형식 산출물에는 구조가 없다.
  assert.equal(readPlan({ 목적: "x" }), null);
  assert.equal(readPlan({ 구조: "{깨짐" }), null);
});

test("확정 사양에서 기획·화면 내용을 꺼내고, 형식이 다르면 null", () => {
  assert.deepEqual(readConfirmedSpec({ 기획: { a: "1" }, 화면: { b: "2" } }), {
    spec: { a: "1" },
    screens: { b: "2" },
  });
  assert.equal(readConfirmedSpec({ 기획: { a: 1 }, 화면: {} }), null);
});

test("확정 문서로 PRD·화면·구현·검증 문서를 만들고 표를 깨뜨리지 않는다", () => {
  const files = documentFiles({
    specVersion: 3,
    spec: renderPlan(COUPONS),
    screens: renderDesign(SCREENS),
  });
  assert.deepEqual(
    files.map((f) => f.path),
    Object.values(DOCUMENT_PATHS),
  );
  const byPath = Object.fromEntries(
    files.map((f) => [f.path, String(f.content)]),
  );
  const prd = byPath[DOCUMENT_PATHS.prd];
  assert.match(prd, /확정 사양 버전 3/);
  assert.match(prd, /### APP-REQ-001 쿠폰 등록/);
  assert.match(
    prd,
    /\| APP-AC-003 \| APP-REQ-002 \| 임박 표시가 보인다 \\\| 강조 \|/,
  );
  assert.match(prd, /로그인 없이 허용하는 동작: 조회, 추가/);
  assert.match(
    prd,
    /## 인증과 공개 범위[\s\S]*앱 주소를 아는 누구나 이 데이터를 쓸 수 있어요: coupons 조회·추가/,
  );
  assert.match(
    byPath[DOCUMENT_PATHS.design],
    /\| 빈 상태 \| 첫 쿠폰을 추가하세요 \|/,
  );
  const designMd = byPath[DOCUMENT_PATHS.design];
  assert.match(designMd, /디자인 지침: Impeccable 4\.10\.0/);
  assert.match(designMd, /- 화면 모드: Operate/);
  assert.match(designMd, /피할 것:\n\n- 장식용 애니메이션/);
  assert.match(designMd, /주 행동: 쿠폰 추가/);
  assert.match(designMd, /\| 불러오는 중 \| 목록 자리 스켈레톤 \|/);
  assert.match(
    byPath[DOCUMENT_PATHS.implementation],
    /\| APP-REQ-002 만료일 순 목록 \| SCR-001 쿠폰 목록 \| coupons 조회 \| APP-AC-002, APP-AC-003 \|/,
  );
  assert.match(
    byPath[DOCUMENT_PATHS.implementation],
    /NEXT_PUBLIC_SUPABASE_URL/,
  );
  // 브라우저 검증이 없으므로 결과를 꾸며 쓰지 않는다.
  assert.equal(
    byPath[DOCUMENT_PATHS.verification].match(/\| 검증 전 \|/g)?.length,
    3,
  );
});

test("구조가 없는 확정 사양도 항목을 잃지 않고 문서로 남긴다", () => {
  const files = documentFiles({
    specVersion: 1,
    spec: { 목적: "데모", 구조: "{}" },
    screens: { 화면: "목록" },
  });
  assert.deepEqual(
    files.map((f) => f.path),
    [DOCUMENT_PATHS.prd, DOCUMENT_PATHS.design],
  );
  assert.match(String(files[0].content), /## 목적\n\n데모/);
  assert.doesNotMatch(String(files[0].content), /구조/);
});

test("개발자가 문서를 고치거나 지워도 확정본으로 되돌린다", () => {
  const docs = [{ path: DOCUMENT_PATHS.prd, content: "확정" }];
  assert.deepEqual(
    withDocuments(
      [
        { path: "app/page.tsx", content: "x" },
        { path: DOCUMENT_PATHS.prd, content: "개발자가 바꿈" },
        { path: DOCUMENT_PATHS.verification, content: "모두 통과" },
      ],
      docs,
    ),
    [{ path: "app/page.tsx", content: "x" }, ...docs],
  );
});

test("로그인 없는 앱의 공개 범위를 데이터 계획의 허용 동작으로 적는다", () => {
  assert.equal(
    renderPlan(COUPONS)["공개 범위"],
    "로그인이 없어 앱 주소를 아는 누구나 이 데이터를 쓸 수 있어요: coupons 조회·추가",
  );
  assert.equal(publicAccessSummary(null), "서버에 저장하는 데이터가 없어요.");
});
