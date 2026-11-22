/**
 * 생성 앱의 DB를 공용 Supabase 프로젝트 안의 **앱 전용 스키마**로 준비한다(DEC-005: 공용 프로젝트 1개, 앱마다 스키마, 서울).
 *
 * - SQL은 `compileInitial`·`compileChange`가 만든 것만 실행한다. 모델이 쓴 SQL은 실행하지 않는다.
 * - 마이그레이션은 트랜잭션 하나로 적용하고, 같은 트랜잭션에서 공용 이력 테이블에 (스키마, 버전, 체크섬)을 기록한다.
 *   그래서 결과가 불명확해도 이력 테이블을 조회하면 적용 여부를 정확히 안다.
 * - 같은 버전에 다른 체크섬이 오면 충돌로 멈춘다. 이미 적용한 버전은 다시 적용하지 않는다.
 * - 앱은 공개(anon) 키와 RLS 정책으로만 데이터에 접근한다. 관리 토큰·service role 키는 앱에 주지 않는다.
 */
import {
  runExternalOperation,
  type ExternalOperationStore,
} from "@/application/external-operations";
import {
  compileChange,
  compileInitial,
  schemaNameFor,
  type DataPlan,
  type Migration,
} from "@/domain/data-plan";

export interface SupabaseAdmin {
  /** 관리 API로 SQL을 실행한다(관리자 권한). 이 모듈이 만든 SQL만 넘긴다. 결과 불명확이면 `OutcomeUnknownError` */
  query(projectRef: string, sql: string): Promise<Record<string, unknown>[]>;
  /** API에 노출된 스키마 목록 */
  exposedSchemas(projectRef: string): Promise<string[]>;
  setExposedSchemas(projectRef: string, schemas: string[]): Promise<void>;
  /** 앱에 넣을 공개(anon) 키. 브라우저에 노출돼도 되는 키이며 권한은 RLS가 정한다. */
  anonKey(projectRef: string): Promise<string>;
}

export class AppDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppDatabaseError";
  }
}

export interface AppDatabaseStore {
  /** 이 프로젝트에 이미 적용한 데이터 계획과 마지막 버전. 없으면 null */
  current(
    projectId: string,
  ): Promise<{ plan: DataPlan; version: number } | null>;
  /** DB 리소스·적용 이력을 기록한다(같은 버전은 한 번만). */
  recordApplied(input: {
    projectId: string;
    projectRef: string;
    schema: string;
    plan: DataPlan;
    migration: Migration;
  }): Promise<void>;
}

/** 공용 이력 테이블. 앱 스키마와 분리해 두고 앱(anon)에는 권한을 주지 않는다. */
const META_SQL = `create schema if not exists "mvpfactory_meta";
revoke all on schema "mvpfactory_meta" from public;
create table if not exists "mvpfactory_meta"."migrations" (
  "schema_name" text not null,
  "version" integer not null,
  "checksum" text not null,
  "applied_at" timestamptz not null default now(),
  primary key ("schema_name", "version")
);`;

/** 이 모듈 안에서만 쓰는 문자열 리터럴. 입력은 검사된 식별자·16진수만 들어온다. */
const lit = (value: string) => {
  if (!/^[a-z0-9_]+$/.test(value))
    throw new AppDatabaseError("내부 값 형식이 올바르지 않습니다.");
  return `'${value}'`;
};

export type AppDatabaseResult = {
  url: string;
  anonKey: string;
  schema: string;
  /** 이번에 새로 적용한 버전. 바뀐 게 없으면 null */
  appliedVersion: number | null;
};

export async function provisionAppDatabase(
  deps: {
    admin: SupabaseAdmin;
    ledger: ExternalOperationStore;
    store: AppDatabaseStore;
  },
  input: {
    projectId: string;
    runId: string;
    projectRef: string;
    owner: string;
    plan: DataPlan;
  },
): Promise<AppDatabaseResult> {
  const { admin, ledger, store } = deps;
  const schema = schemaNameFor(input.projectId);
  const current = await store.current(input.projectId);
  const migration = current
    ? compileChange(schema, current.plan, input.plan, current.version + 1)
    : compileInitial(schema, input.plan);

  let appliedVersion: number | null = null;
  if (migration) {
    await admin.query(input.projectRef, META_SQL);
    const applied = async () =>
      (
        await admin.query(
          input.projectRef,
          `select "checksum" from "mvpfactory_meta"."migrations" where "schema_name" = ${lit(schema)} and "version" = ${migration.version};`,
        )
      )[0]?.checksum as string | undefined;

    await runExternalOperation(ledger, {
      operationKey: `supabase:migration:${input.projectId}:${migration.version}`,
      projectId: input.projectId,
      runId: input.runId,
      provider: "supabase",
      kind: "APPLY_MIGRATION",
      targetAccount: input.owner,
      requestHash: migration.checksum,
      async execute() {
        const existing = await applied();
        if (existing && existing !== migration.checksum)
          throw new AppDatabaseError(
            `마이그레이션 버전 ${migration.version}이 이미 다른 내용으로 적용돼 있어 멈췄어요.`,
          );
        if (!existing)
          // 스키마 변경과 이력 기록을 한 트랜잭션으로 묶는다.
          await admin.query(
            input.projectRef,
            `begin;\n${migration.sql}\ninsert into "mvpfactory_meta"."migrations" ("schema_name", "version", "checksum") values (${lit(schema)}, ${migration.version}, ${lit(migration.checksum)});\ncommit;`,
          );
        return {
          externalId: `${schema}@${migration.version}`,
          evidence: { checksum: migration.checksum },
        };
      },
      async reconcile() {
        const existing = await applied();
        if (!existing) return { found: false };
        if (existing !== migration.checksum)
          throw new AppDatabaseError(
            `마이그레이션 버전 ${migration.version}이 이미 다른 내용으로 적용돼 있어 멈췄어요.`,
          );
        return { found: true, externalId: `${schema}@${migration.version}` };
      },
    });
    await store.recordApplied({
      projectId: input.projectId,
      projectRef: input.projectRef,
      schema,
      plan: input.plan,
      migration,
    });
    appliedVersion = migration.version;
  }

  // 앱이 이 스키마를 API로 쓸 수 있게 노출한다(다른 스키마 설정은 유지).
  const exposed = await admin.exposedSchemas(input.projectRef);
  if (!exposed.includes(schema))
    await admin.setExposedSchemas(input.projectRef, [...exposed, schema]);

  return {
    url: `https://${input.projectRef}.supabase.co`,
    anonKey: await admin.anonKey(input.projectRef),
    schema,
    appliedVersion,
  };
}
