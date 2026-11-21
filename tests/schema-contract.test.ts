import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BLOCKED_REASONS,
  CEO_LEVELS,
  CONNECTION_STATUSES,
  DECISION_CHOICES,
  DECISION_KINDS,
  DECISION_STATUSES,
  EXTERNAL_OPERATION_STATUSES,
  MEETING_STATUSES,
  PROVIDERS,
  REPO_VISIBILITIES,
  ROLE_IDS,
  RUN_MODES,
  RUN_STATUSES,
  RUN_TYPES,
  VERIFICATION_RESULTS,
} from "@/contracts";

const SCHEMA_DIR = "prisma/schema";

function prismaEnums(): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) =>
    f.endsWith(".prisma"),
  )) {
    const text = readFileSync(`${SCHEMA_DIR}/${file}`, "utf8");
    for (const match of text.matchAll(/^enum (\w+) \{([^}]*)\}/gm)) {
      const values = match[2]
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter(Boolean);
      enums.set(match[1], values);
    }
  }
  return enums;
}

test("Prisma 열거형은 계약의 상수와 값·순서가 같다", () => {
  const enums = prismaEnums();
  const expected: Record<string, readonly string[]> = {
    CeoLevel: CEO_LEVELS,
    RunMode: RUN_MODES,
    RunType: RUN_TYPES,
    RunStatus: RUN_STATUSES,
    BlockedReason: BLOCKED_REASONS,
    RoleId: ROLE_IDS,
    ArtifactAuthor: [...ROLE_IDS, "SYSTEM"],
    DecisionKind: DECISION_KINDS,
    DecisionStatus: DECISION_STATUSES,
    DecisionChoice: DECISION_CHOICES,
    Provider: PROVIDERS,
    ConnectionStatus: CONNECTION_STATUSES,
    RepoVisibility: REPO_VISIBILITIES,
    ExternalOperationStatus: EXTERNAL_OPERATION_STATUSES,
    MeetingStatus: MEETING_STATUSES,
    VerificationResult: VERIFICATION_RESULTS,
  };
  for (const [name, values] of Object.entries(expected)) {
    assert.deepEqual(
      enums.get(name),
      [...values],
      `${name} 열거형이 계약과 다릅니다.`,
    );
  }
});

test("migrations 폴더는 스키마 폴더 안에 있고 열거형이 마이그레이션에도 반영된다", () => {
  const migrations = readdirSync(`${SCHEMA_DIR}/migrations`).filter((f) =>
    /^\d{14}_/.test(f),
  );
  assert.ok(migrations.length >= 1);
  const sql = migrations
    .map((dir) =>
      readFileSync(`${SCHEMA_DIR}/migrations/${dir}/migration.sql`, "utf8"),
    )
    .join("\n");
  for (const [name, values] of prismaEnums()) {
    const quoted = values.map((v) => `'${v}'`).join(", ");
    assert.ok(
      sql.includes(`CREATE TYPE "${name}" AS ENUM (${quoted})`),
      `${name} 열거형이 마이그레이션에 없거나 다릅니다.`,
    );
  }
});
