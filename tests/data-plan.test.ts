import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { after, describe, test } from "node:test";
import { Client } from "pg";
import {
  DataPlanError,
  UnsupportedDataAccessError,
  compileChange,
  compileInitial,
  parseDataPlan,
  schemaNameFor,
  type DataPlan,
} from "@/domain/data-plan";

const PLAN = {
  tables: [
    {
      name: "water_logs",
      fields: [
        { name: "log_date", type: "date", required: true },
        { name: "cups", type: "integer", required: true },
        { name: "memo", type: "text", required: false },
      ],
      access: { read: true, insert: true, update: true, delete: false },
    },
  ],
};

describe("데이터 계획 검사", () => {
  test("권한 객체·키·boolean을 검사하고 명시적 비공개 계획은 별도 오류로 구분한다", () => {
    const parse = (access: unknown) =>
      parseDataPlan({ tables: [{ ...PLAN.tables[0], access }] });
    for (const access of [undefined, null, [], "read"])
      assert.throws(() => parse(access), /객체여야/);
    assert.throws(() => parse({ read: "true", insert: true }), /문자열이 아닌/);
    assert.throws(() => parse({ read: true, insert: 1 }), /true 또는 false/);
    assert.throws(
      () => parse({ read: true, write: true }),
      /read, insert, update, delete만/,
    );
    assert.throws(
      () => parse({ read: false, insert: false, update: false, delete: false }),
      UnsupportedDataAccessError,
    );
    assert.deepEqual(parse({ insert: true }).tables[0].access, {
      read: false,
      insert: true,
      update: false,
      delete: false,
    });
  });
  test("올바른 계획을 받아들이고 접근 범위의 빈 값은 거부로 본다", () => {
    const plan = parseDataPlan({
      tables: [{ ...PLAN.tables[0], access: { read: true } }],
    });
    assert.deepEqual(plan.tables[0].access, {
      read: true,
      insert: false,
      update: false,
      delete: false,
    });
  });

  test("위험한 이름·타입·형태를 거부한다", () => {
    const bad = (mutate: (t: Record<string, unknown>) => void) => {
      const table = structuredClone(PLAN.tables[0]) as unknown as Record<
        string,
        unknown
      >;
      mutate(table);
      return () => parseDataPlan({ tables: [table] });
    };
    for (const name of [
      'logs"; drop table x; --',
      "Logs",
      "1logs",
      "id",
      "user",
      "a".repeat(41),
      "",
    ])
      assert.throws(
        bad((t) => (t.name = name)),
        DataPlanError,
        name,
      );
    assert.throws(
      bad((t) => ((t.fields as { name: string }[])[0].name = "created_at")),
      DataPlanError,
    );
    assert.throws(
      bad((t) => ((t.fields as { type: string }[])[0].type = "jsonb")),
      DataPlanError,
    );
    assert.throws(
      bad((t) => ((t.fields as { type: string }[])[0].type = "text; drop")),
      DataPlanError,
    );
    assert.throws(
      bad((t) => (t.fields = [])),
      DataPlanError,
    );
    assert.throws(
      bad((t) => (t.access = { update: true })),
      /읽기나 쓰기/,
    );
    assert.throws(() => parseDataPlan({ tables: [] }), DataPlanError);
    assert.throws(
      () => parseDataPlan({ tables: [PLAN.tables[0], PLAN.tables[0]] }),
      /중복/,
    );
  });

  test("스키마 이름은 프로젝트마다 고정이고 안전한 형식이다", () => {
    assert.equal(
      schemaNameFor("cmwqap8v000010k7z65f63x4g"),
      "app_0k7z65f63x4g".slice(0, 16),
    );
    assert.match(schemaNameFor("ABC-123_xyz"), /^app_[a-z0-9]+$/);
  });

  test("수정은 추가만 허용한다", () => {
    const base = parseDataPlan(PLAN);
    const withField = parseDataPlan({
      tables: [
        {
          ...PLAN.tables[0],
          fields: [
            ...PLAN.tables[0].fields,
            { name: "goal", type: "integer", required: false },
          ],
        },
      ],
    });
    const change = compileChange("app_x", base, withField, 2)!;
    assert.equal(change.version, 2);
    assert.match(
      change.sql,
      /alter table "app_x"."water_logs" add column "goal" integer;/,
    );
    assert.equal(
      compileChange("app_x", base, base, 2),
      null,
      "바뀐 게 없으면 마이그레이션도 없다",
    );

    const required = parseDataPlan({
      tables: [
        {
          ...PLAN.tables[0],
          fields: [
            ...PLAN.tables[0].fields,
            { name: "goal", type: "integer", required: true },
          ],
        },
      ],
    });
    assert.throws(
      () => compileChange("app_x", base, required, 2),
      /선택 항목이어야/,
    );
    const dropped = parseDataPlan({
      tables: [
        { ...PLAN.tables[0], fields: PLAN.tables[0].fields.slice(0, 2) },
      ],
    });
    assert.throws(() => compileChange("app_x", base, dropped, 2), /필드 삭제/);
    const retyped = parseDataPlan({
      tables: [
        {
          ...PLAN.tables[0],
          fields: [
            { name: "log_date", type: "text", required: true },
            ...PLAN.tables[0].fields.slice(1),
          ],
        },
      ],
    });
    assert.throws(
      () => compileChange("app_x", base, retyped, 2),
      /타입이나 필수/,
    );
    const widened = parseDataPlan({
      tables: [
        {
          ...PLAN.tables[0],
          access: { ...PLAN.tables[0].access, delete: true },
        },
      ],
    });
    assert.throws(
      () => compileChange("app_x", base, widened, 2),
      /넓히지 않아요/,
    );
    const other = parseDataPlan({
      tables: [{ ...PLAN.tables[0], name: "other" }],
    });
    assert.throws(() => compileChange("app_x", base, other, 2), /테이블 삭제/);
  });
});

describe("컴파일한 SQL을 실제 PostgreSQL에서 실행(트랜잭션 후 롤백)", () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  after(() => client.end());

  test("허용한 동작만 anon에게 열리고, 수정 마이그레이션이 기존 행을 보존한다", async () => {
    await client.connect();
    await client.query("begin");
    try {
      // Supabase의 anon 역할을 흉내 낸다(이 트랜잭션 안에서만).
      await client.query(
        "do $$ begin if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;",
      );
      const schema = "app_testplan01";
      const plan: DataPlan = parseDataPlan(PLAN);
      await client.query(compileInitial(schema, plan).sql);

      await client.query("set local role anon");
      await client.query(
        `insert into "${schema}"."water_logs" (log_date, cups) values ('2026-11-21', 3)`,
      );
      assert.equal(
        (await client.query(`select cups from "${schema}"."water_logs"`))
          .rows[0].cups,
        3,
      );
      await client.query(`update "${schema}"."water_logs" set cups = 4`);
      await client.query("savepoint s1");
      await assert.rejects(
        client.query(`delete from "${schema}"."water_logs"`),
        /permission denied/,
      );
      await client.query("rollback to savepoint s1");
      await assert.rejects(
        client.query(
          `insert into "${schema}"."water_logs" (log_date) values ('2026-11-22')`,
        ),
        /null value/,
      );
      await client.query("rollback to savepoint s1");
      await assert.rejects(
        client.query(
          `insert into "${schema}"."water_logs" (id, log_date, cups) values (99, '2026-11-22', 1)`,
        ),
        /cannot insert a non-DEFAULT value into column "id"|permission denied/,
      );
      await client.query("rollback to savepoint s1");
      await client.query("reset role");

      // 수정: 선택 필드 추가. 기존 행이 남고, 이전 앱처럼 새 필드 없이도 쓸 수 있다.
      const next = parseDataPlan({
        tables: [
          {
            ...PLAN.tables[0],
            fields: [
              ...PLAN.tables[0].fields,
              { name: "goal", type: "integer", required: false },
            ],
          },
        ],
      });
      await client.query(compileChange(schema, plan, next, 2)!.sql);
      await client.query("set local role anon");
      await client.query(
        `insert into "${schema}"."water_logs" (log_date, cups) values ('2026-11-22', 2)`,
      );
      const rows = (
        await client.query(
          `select cups, goal from "${schema}"."water_logs" order by id`,
        )
      ).rows;
      assert.deepEqual(rows, [
        { cups: 4, goal: null },
        { cups: 2, goal: null },
      ]);
      await client.query("reset role");

      // RLS가 켜져 있다.
      const rls = await client.query(
        `select relrowsecurity from pg_class where oid = '"${schema}"."water_logs"'::regclass`,
      );
      assert.equal(rls.rows[0].relrowsecurity, true);
    } finally {
      await client.query("rollback");
    }
  });
});
