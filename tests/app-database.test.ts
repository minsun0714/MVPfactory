import "@tests/helpers/test-database"; // 반드시 가장 먼저: 개발 DB 대신 테스트 DB를 쓴다
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { Client } from "pg";
import {
  AppDatabaseError,
  provisionAppDatabase,
  type SupabaseAdmin,
} from "@/application/app-database";
import { OutcomeUnknownError } from "@/application/external-operations";
import { parseDataPlan, schemaNameFor } from "@/domain/data-plan";
import { db, WORKSPACE_ID } from "@/lib/db";
import { createAppDatabaseStore } from "@/infrastructure/prisma/app-database-store";
import { createExternalOperationStore } from "@/infrastructure/prisma/external-operation-store";
import {
  createSupabaseAdmin,
  SupabaseApiError,
} from "@/infrastructure/supabase/supabase-admin";

const pg = new Client({ connectionString: process.env.DATABASE_URL });
const ledger = createExternalOperationStore(db);
const store = createAppDatabaseStore(db);
const schemas: string[] = [];
let runId = "";

const PLAN = parseDataPlan({
  tables: [
    {
      name: "water_logs",
      fields: [{ name: "cups", type: "integer", required: true }],
      access: { read: true, insert: true, update: false, delete: false },
    },
  ],
});
const PLAN_V2 = parseDataPlan({
  tables: [
    {
      ...PLAN.tables[0],
      fields: [
        ...PLAN.tables[0].fields,
        { name: "memo", type: "text", required: false },
      ],
    },
    {
      name: "goals",
      fields: [{ name: "target", type: "integer", required: true }],
      access: { read: true, insert: true, update: true, delete: false },
    },
  ],
});

/** 관리 API 대신 로컬 테스트 DB에서 실제 SQL을 실행하는 모의 Supabase. 호출을 기록한다. */
function localSupabase(opts: { unknownOnce?: boolean } = {}) {
  const sql: string[] = [];
  let exposed = ["public", "graphql_public"];
  let unknownOnce = opts.unknownOnce ?? false;
  const admin: SupabaseAdmin = {
    async query(_ref, text) {
      sql.push(text);
      const result = await pg.query(text);
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      if (unknownOnce && text.startsWith("begin;")) {
        unknownOnce = false;
        throw new OutcomeUnknownError(); // 적용은 됐지만 응답을 못 받은 상황
      }
      return last?.rows ?? [];
    },
    exposedSchemas: async () => [...exposed],
    setExposedSchemas: async (_ref, list) => void (exposed = list),
    anonKey: async () => "anon-public-key",
  };
  return {
    admin,
    sql,
    exposed: () => exposed,
    applies: () => sql.filter((s) => s.startsWith("begin;")).length,
  };
}

async function newProject() {
  const project = await db.project.create({
    data: {
      workspaceId: WORKSPACE_ID,
      name: "DB",
      idea: "x",
      ceoLevel: "DELEGATE",
    },
  });
  schemas.push(schemaNameFor(project.id));
  return project.id;
}

before(async () => {
  await pg.connect();
  await pg.query(
    "do $$ begin if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;",
  );
  await db.workspace.upsert({
    where: { id: WORKSPACE_ID },
    create: { id: WORKSPACE_ID },
    update: {},
  });
  const p = await newProject();
  await db.activeRunLock.deleteMany({ where: { workspaceId: WORKSPACE_ID } });
  runId = (
    await db.run.create({
      data: {
        projectId: p,
        type: "INITIAL",
        mode: "REAL",
        status: "RUNNING",
        ceoLevel: "DELEGATE",
        projectGeneration: 1,
        workflowVersion: "t",
        promptVersion: "t",
        modelConfig: {},
        limits: {},
        threadId: randomUUID(),
      },
    })
  ).id;
});
after(async () => {
  for (const s of schemas)
    await pg.query(`drop schema if exists "${s}" cascade`);
  await pg
    .query(
      `delete from "mvpfactory_meta"."migrations" where schema_name = any($1)`,
      [schemas],
    )
    .catch(() => undefined);
  await pg.end();
  await db.$disconnect();
});

const input = (projectId: string, plan = PLAN) => ({
  projectId,
  runId,
  projectRef: "abcdefghijklmnop",
  owner: "org",
  plan,
});

describe("앱 DB 준비(공용 프로젝트 + 앱 스키마)", () => {
  test("처음에는 스키마와 테이블을 만들고 이력을 남기며, 같은 계획을 다시 요청하면 아무것도 바꾸지 않는다", async () => {
    const projectId = await newProject();
    const sb = localSupabase();
    const result = await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId),
    );
    assert.equal(result.schema, schemaNameFor(projectId));
    assert.equal(result.url, "https://abcdefghijklmnop.supabase.co");
    assert.equal(result.anonKey, "anon-public-key");
    assert.equal(result.appliedVersion, 1);
    assert.ok(sb.exposed().includes(result.schema));
    assert.ok(
      sb.exposed().includes("public"),
      "다른 스키마 노출 설정은 유지한다",
    );
    const meta = await pg.query(
      `select version from "mvpfactory_meta"."migrations" where schema_name = $1`,
      [result.schema],
    );
    assert.deepEqual(meta.rows, [{ version: 1 }]);
    const resource = await db.externalResource.findFirstOrThrow({
      where: { projectId, kind: "DATABASE" },
      include: { migrations: true },
    });
    assert.equal(resource.migrations.length, 1);

    const again = await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId),
    );
    assert.equal(again.appliedVersion, null);
    assert.equal(sb.applies(), 1, "마이그레이션을 다시 실행하지 않는다");
  });

  test("수정 계획은 추가 마이그레이션으로 적용하고 기존 데이터를 보존한다", async () => {
    const projectId = await newProject();
    const sb = localSupabase();
    const first = await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId),
    );
    await pg.query(
      `insert into "${first.schema}"."water_logs" (cups) values (5)`,
    );
    const second = await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId, PLAN_V2),
    );
    assert.equal(second.appliedVersion, 2);
    const rows = (
      await pg.query(`select cups, memo from "${first.schema}"."water_logs"`)
    ).rows;
    assert.deepEqual(rows, [{ cups: 5, memo: null }]);
    assert.equal(
      (
        await pg.query(
          `select count(*)::int as n from "${first.schema}"."goals"`,
        )
      ).rows[0].n,
      0,
    );
  });

  test("적용 결과가 불명확해도 다시 시도할 때 이력으로 확인해 중복 적용하지 않는다", async () => {
    const projectId = await newProject();
    const sb = localSupabase({ unknownOnce: true });
    await assert.rejects(
      provisionAppDatabase(
        { admin: sb.admin, ledger, store },
        input(projectId),
      ),
      OutcomeUnknownError,
    );
    const result = await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId),
    );
    assert.equal(result.appliedVersion, 1);
    assert.equal(sb.applies(), 1, "실제 SQL 적용은 한 번뿐");
  });

  test("같은 버전이 다른 내용으로 이미 적용돼 있으면 멈춘다", async () => {
    const projectId = await newProject();
    const schema = schemaNameFor(projectId);
    const sb = localSupabase();
    await sb.admin.query(
      "r",
      `create schema if not exists "mvpfactory_meta"; create table if not exists "mvpfactory_meta"."migrations" ("schema_name" text not null, "version" integer not null, "checksum" text not null, "applied_at" timestamptz not null default now(), primary key ("schema_name","version"));`,
    );
    await pg.query(
      `insert into "mvpfactory_meta"."migrations" values ($1, 1, 'deadbeef', now())`,
      [schema],
    );
    await assert.rejects(
      provisionAppDatabase(
        { admin: sb.admin, ledger, store },
        input(projectId),
      ),
      AppDatabaseError,
    );
    assert.equal(sb.applies(), 0);
  });

  test("허용하지 않는 수정(필드 삭제 등)은 DB에 닿기 전에 거부한다", async () => {
    const projectId = await newProject();
    const sb = localSupabase();
    await provisionAppDatabase(
      { admin: sb.admin, ledger, store },
      input(projectId, PLAN_V2),
    );
    const before = sb.sql.length;
    await assert.rejects(
      provisionAppDatabase(
        { admin: sb.admin, ledger, store },
        input(projectId, PLAN),
      ),
      /필드 삭제|테이블 삭제/,
    );
    assert.equal(sb.sql.length, before);
  });
});

describe("Supabase 관리 API 클라이언트", () => {
  const TOKEN = "sbp_secret_token_123456";
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  function server(handler: (url: string, init: RequestInit) => Response) {
    const hits: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => (
      hits.push({ url, init }),
      handler(url, init)
    )) as unknown as typeof fetch;
    return {
      hits,
      admin: createSupabaseAdmin({ token: TOKEN, fetch: fetchFn }),
    };
  }

  test("SQL·노출 스키마·공개 키 요청 형식", async () => {
    const { hits, admin } = server((url, init) => {
      if (url.endsWith("/database/query")) return json([{ a: 1 }]);
      if (url.endsWith("/postgrest") && init.method === "GET")
        return json({ db_schema: "public, graphql_public" });
      if (url.endsWith("/postgrest")) return json({});
      return json([
        { name: "anon", api_key: "anon-key" },
        { name: "service_role", api_key: "secret" },
      ]);
    });
    assert.deepEqual(await admin.query("ref1", "select 1"), [{ a: 1 }]);
    assert.deepEqual(JSON.parse(hits[0].init.body as string), {
      query: "select 1",
    });
    assert.deepEqual(await admin.exposedSchemas("ref1"), [
      "public",
      "graphql_public",
    ]);
    await admin.setExposedSchemas("ref1", ["public", "app_x"]);
    assert.deepEqual(JSON.parse(hits[2].init.body as string), {
      db_schema: "public,app_x",
    });
    assert.equal(
      await admin.anonKey("ref1"),
      "anon-key",
      "service_role 키는 쓰지 않는다",
    );
    assert.equal(
      (hits[0].init.headers as Record<string, string>).authorization,
      `Bearer ${TOKEN}`,
    );
  });

  test("오류에는 토큰이 없고, 변경 요청의 연결 끊김은 결과 불명확이다", async () => {
    await assert.rejects(
      server(() => json({ message: "denied" }, 403)).admin.anonKey("r"),
      (e: unknown) =>
        e instanceof SupabaseApiError &&
        e.status === 403 &&
        !e.message.includes(TOKEN),
    );
    const down = createSupabaseAdmin({
      token: TOKEN,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await assert.rejects(down.query("r", "select 1"), OutcomeUnknownError);
    await assert.rejects(
      down.exposedSchemas("r"),
      (e: unknown) => e instanceof SupabaseApiError && e.status === 0,
    );
  });
});
