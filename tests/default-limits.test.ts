import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  resolveRunLimits,
  DEFAULT_RUN_LIMITS,
  workspaceRunLimits,
} from "@/infrastructure/integrations/default-limits";
const empty = {
  maxModelCalls: null,
  maxFixAttempts: null,
  maxActiveSeconds: null,
  maxEstimatedCost: null,
};
test("empty DB and environment restore code defaults", () => {
  assert.deepEqual(resolveRunLimits(empty, {}), DEFAULT_RUN_LIMITS);
});
test("environment overrides defaults independently per field", () => {
  assert.deepEqual(
    resolveRunLimits(empty, {
      DEFAULT_MAX_MODEL_CALLS: "80",
      DEFAULT_MAX_ESTIMATED_COST_USD: "2.5",
    }),
    { ...DEFAULT_RUN_LIMITS, maxModelCalls: 80, maxEstimatedCost: 2.5 },
  );
});
test("saved DB settings override environment, including explicit zero", () => {
  const stored = { ...empty, maxModelCalls: 12, maxFixAttempts: 0 };
  assert.deepEqual(
    resolveRunLimits(stored, {
      DEFAULT_MAX_MODEL_CALLS: "99",
      DEFAULT_MAX_FIX_ATTEMPTS: "9",
    }),
    { ...DEFAULT_RUN_LIMITS, maxModelCalls: 12, maxFixAttempts: 0 },
  );
  assert.equal(stored.maxActiveSeconds, null);
});
test("invalid or blank environment values fall back without disabling limits", () => {
  for (const raw of ["", " ", "abc", "Infinity", "-1", "1.5", "2147483648"])
    assert.equal(
      resolveRunLimits(empty, { DEFAULT_MAX_MODEL_CALLS: raw }).maxModelCalls,
      50,
    );
  assert.equal(
    resolveRunLimits(empty, { DEFAULT_MAX_MODEL_CALLS: "0" }).maxModelCalls,
    0,
  );
});
test("workspace mapping preserves stored decimal costs for settings and new-run snapshots", () => {
  assert.deepEqual(
    workspaceRunLimits({
      limitMaxModelCalls: 12,
      limitMaxFixAttempts: 2,
      limitMaxActiveSeconds: 120,
      limitMaxEstimatedCost: { toString: () => "1.75" },
    }),
    {
      maxModelCalls: 12,
      maxFixAttempts: 2,
      maxActiveSeconds: 120,
      maxEstimatedCost: 1.75,
    },
  );
});
