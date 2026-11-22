/**
 * 생성 앱의 선언형 데이터 계획과 신뢰된 SQL 컴파일러(ARCHITECTURE §10).
 *
 * - 모델은 SQL을 쓰지 않는다. 테이블·필드·접근 범위만 선언하고, 이 모듈이 검사한 뒤 SQL을 만든다.
 * - 식별자는 정해진 형식만 허용하고 항상 따옴표로 감싼다. 타입은 허용 목록만 쓴다.
 * - 앱마다 전용 스키마를 쓰며, 로그인이 없는 앱이므로 공개 키(anon)에 **계획이 허용한 동작만** 정책으로 연다.
 * - 수정은 추가만 허용한다: 새 테이블, 새 선택(nullable) 필드. 삭제·필수 필드 추가·권한 확대·타입 변경은 거부한다.
 */
import { createHash } from "node:crypto";

export const FIELD_TYPES = [
  "text",
  "integer",
  "numeric",
  "boolean",
  "date",
  "timestamptz",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const ACCESS_ACTIONS = ["read", "insert", "update", "delete"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export type DataField = { name: string; type: FieldType; required: boolean };
export type DataTable = {
  name: string;
  fields: DataField[];
  /** 로그인 없는 방문자(anon)에게 허용하는 동작 */
  access: Record<AccessAction, boolean>;
};
export type DataPlan = { tables: DataTable[] };

export class DataPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataPlanError";
  }
}

/** Explicitly private tables need authenticated policies, not a format retry that opens anon access. */
export class UnsupportedDataAccessError extends DataPlanError {
  constructor(table: string) {
    super(
      `${table}: 모든 공개 접근이 차단된 데이터 계획이에요. 현재 자동 DB 구성은 비인증 방문자용 정책만 지원합니다. 비공개 데이터를 저장하려면 인증·사용자별 접근 정책 구현이 필요해요. 공개 권한을 임의로 켜지는 않았습니다.`,
    );
    this.name = "UnsupportedDataAccessError";
  }
}

const IDENT = /^[a-z][a-z0-9_]{0,39}$/;
/** 시스템이 자동으로 넣는 열과 PostgreSQL 예약어 일부. 겹치면 거부한다. */
const RESERVED = new Set([
  "id",
  "created_at",
  "user",
  "order",
  "group",
  "select",
  "table",
  "from",
  "where",
  "limit",
]);
const MAX_TABLES = 8;
const MAX_FIELDS = 20;

function ident(value: unknown, what: string): string {
  if (typeof value !== "string" || !IDENT.test(value) || RESERVED.has(value))
    throw new DataPlanError(
      `${what} 이름이 올바르지 않아요: ${String(value).slice(0, 40)} (영문 소문자·숫자·밑줄, 예약어 제외)`,
    );
  return value;
}

/** 모델 출력 같은 외부 입력을 검사해 계획으로 좁힌다. */
export function parseDataPlan(input: unknown): DataPlan {
  const raw = (input ?? {}) as { tables?: unknown };
  if (
    !Array.isArray(raw.tables) ||
    raw.tables.length === 0 ||
    raw.tables.length > MAX_TABLES
  )
    throw new DataPlanError(`테이블은 1~${MAX_TABLES}개여야 해요.`);
  const tableNames = new Set<string>();
  const tables = raw.tables.map((t): DataTable => {
    const table = (t ?? {}) as {
      name?: unknown;
      fields?: unknown;
      access?: unknown;
    };
    const name = ident(table.name, "테이블");
    if (tableNames.has(name))
      throw new DataPlanError(`테이블 이름이 중복돼요: ${name}`);
    tableNames.add(name);
    if (
      !Array.isArray(table.fields) ||
      table.fields.length === 0 ||
      table.fields.length > MAX_FIELDS
    )
      throw new DataPlanError(`${name}: 필드는 1~${MAX_FIELDS}개여야 해요.`);
    const fieldNames = new Set<string>();
    const fields = table.fields.map((f): DataField => {
      const field = (f ?? {}) as {
        name?: unknown;
        type?: unknown;
        required?: unknown;
      };
      const fieldName = ident(field.name, `${name} 필드`);
      if (fieldNames.has(fieldName))
        throw new DataPlanError(`${name}: 필드 이름이 중복돼요: ${fieldName}`);
      fieldNames.add(fieldName);
      if (!FIELD_TYPES.includes(field.type as FieldType))
        throw new DataPlanError(
          `${name}.${fieldName}: 지원하지 않는 타입이에요(${FIELD_TYPES.join(", ")}).`,
        );
      return {
        name: fieldName,
        type: field.type as FieldType,
        required: field.required === true,
      };
    });
    if (
      !table.access ||
      typeof table.access !== "object" ||
      Array.isArray(table.access)
    )
      throw new DataPlanError(
        `${name}: access는 read, insert, update, delete를 키로 갖는 객체여야 해요.`,
      );
    const access = table.access as Record<string, unknown>;
    for (const [action, value] of Object.entries(access)) {
      if (!ACCESS_ACTIONS.some((known) => known === action))
        throw new DataPlanError(
          `${name}: access에는 read, insert, update, delete만 사용하세요.`,
        );
      if (typeof value !== "boolean")
        throw new DataPlanError(
          `${name}: access.${action}은 문자열이 아닌 true 또는 false여야 해요.`,
        );
    }
    const allowed = Object.fromEntries(
      ACCESS_ACTIONS.map((a) => [a, access[a] === true]),
    ) as Record<AccessAction, boolean>;
    if (ACCESS_ACTIONS.every((action) => access[action] === false))
      throw new UnsupportedDataAccessError(name);
    if (!allowed.read && !allowed.insert)
      throw new DataPlanError(
        `${name}: 읽기나 쓰기 중 하나는 허용해야 해요(access.read 또는 access.insert). 사용자 요구에서 공개 허용된 동작만 지정하세요. 비공개 데이터의 권한을 임의로 넓히면 안 됩니다.`,
      );
    return { name, fields, access: allowed };
  });
  return { tables };
}

/** 프로젝트마다 고정된 스키마 이름 */
export function schemaNameFor(projectId: string): string {
  return `app_${projectId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-12)}`;
}

const q = (identifier: string) => `"${identifier}"`;
const SQL_TYPE: Record<FieldType, string> = {
  text: "text",
  integer: "integer",
  numeric: "numeric",
  boolean: "boolean",
  date: "date",
  timestamptz: "timestamptz",
};
const GRANT: Record<AccessAction, string> = {
  read: "select",
  insert: "insert",
  update: "update",
  delete: "delete",
};

function columnSql(field: DataField): string {
  return `${q(field.name)} ${SQL_TYPE[field.type]}${field.required ? " not null" : ""}`;
}

function accessSql(
  schema: string,
  table: string,
  actions: AccessAction[],
): string[] {
  const target = `${q(schema)}.${q(table)}`;
  return actions.flatMap((action) => {
    const policy = q(`anon_${action}`);
    const rule =
      action === "read"
        ? "for select to anon using (true)"
        : action === "insert"
          ? "for insert to anon with check (true)"
          : action === "update"
            ? "for update to anon using (true) with check (true)"
            : "for delete to anon using (true)";
    return [
      `grant ${GRANT[action]} on ${target} to anon;`,
      `create policy ${policy} on ${target} ${rule};`,
    ];
  });
}

const allowedActions = (table: DataTable) =>
  ACCESS_ACTIONS.filter((a) => table.access[a]);

function createTableSql(schema: string, table: DataTable): string[] {
  const target = `${q(schema)}.${q(table.name)}`;
  return [
    `create table ${target} (\n  "id" bigint generated always as identity primary key,\n  "created_at" timestamptz not null default now(),\n  ${table.fields.map(columnSql).join(",\n  ")}\n);`,
    // RLS를 켜고, 계획이 허용한 동작만 정책으로 연다.
    `alter table ${target} enable row level security;`,
    ...accessSql(schema, table.name, allowedActions(table)),
  ];
}

export type Migration = { version: number; sql: string; checksum: string };

const checksumOf = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");

/** 첫 마이그레이션: 스키마와 모든 테이블을 만든다. */
export function compileInitial(schema: string, plan: DataPlan): Migration {
  ident(schema.replace(/^app_/, "a"), "스키마");
  const sql = [
    `create schema ${q(schema)};`,
    `grant usage on schema ${q(schema)} to anon;`,
    ...plan.tables.flatMap((t) => createTableSql(schema, t)),
  ].join("\n");
  return { version: 1, sql, checksum: checksumOf(sql) };
}

/**
 * 수정 마이그레이션: 이전 계획과 비교해 추가만 허용한다. 바뀐 것이 없으면 null.
 * 기존 행과 이전 버전 앱이 계속 동작하도록 새 필드는 선택(nullable)이어야 한다.
 */
export function compileChange(
  schema: string,
  previous: DataPlan,
  next: DataPlan,
  version: number,
): Migration | null {
  const statements: string[] = [];
  const before = new Map(previous.tables.map((t) => [t.name, t]));
  for (const old of previous.tables)
    if (!next.tables.some((t) => t.name === old.name))
      throw new DataPlanError(
        `${old.name}: 테이블 삭제는 자동으로 하지 않아요.`,
      );
  for (const table of next.tables) {
    const old = before.get(table.name);
    if (!old) {
      statements.push(...createTableSql(schema, table));
      continue;
    }
    for (const field of old.fields) {
      const now = table.fields.find((f) => f.name === field.name);
      if (!now)
        throw new DataPlanError(
          `${table.name}.${field.name}: 필드 삭제는 자동으로 하지 않아요.`,
        );
      if (now.type !== field.type || now.required !== field.required)
        throw new DataPlanError(
          `${table.name}.${field.name}: 타입이나 필수 여부는 바꿀 수 없어요.`,
        );
    }
    for (const field of table.fields) {
      if (old.fields.some((f) => f.name === field.name)) continue;
      if (field.required)
        throw new DataPlanError(
          `${table.name}.${field.name}: 기존 데이터가 있어 새 필드는 선택 항목이어야 해요.`,
        );
      statements.push(
        `alter table ${q(schema)}.${q(table.name)} add column ${columnSql(field)};`,
      );
    }
    for (const action of ACCESS_ACTIONS) {
      if (table.access[action] && !old.access[action])
        throw new DataPlanError(
          `${table.name}: 접근 권한(${action})을 자동으로 넓히지 않아요.`,
        );
      if (!table.access[action] && old.access[action])
        throw new DataPlanError(
          `${table.name}: 접근 권한(${action})을 자동으로 줄이지 않아요. 기존 앱이 깨질 수 있어요.`,
        );
    }
  }
  if (statements.length === 0) return null;
  const sql = statements.join("\n");
  return { version, sql, checksum: checksumOf(sql) };
}

/** 사양(산출물)에 데이터 계획을 담는 키 */
export const SPEC_DATA_NEED = "데이터 저장";
export const SPEC_DATA_PLAN = "데이터 계획";

/** 사양에서 데이터 계획을 읽는다. 저장이 필요 없는 앱이면 null */
export function dataPlanOf(spec: Record<string, string>): DataPlan | null {
  if (spec[SPEC_DATA_NEED] !== "필요") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(spec[SPEC_DATA_PLAN] ?? "");
  } catch {
    throw new DataPlanError("사양의 데이터 계획을 읽을 수 없어요.");
  }
  return parseDataPlan(raw);
}
