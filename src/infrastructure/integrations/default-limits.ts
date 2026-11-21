import type { RunLimits } from "@/contracts";

export const DEFAULT_RUN_LIMITS = {
  maxModelCalls: 50,
  maxFixAttempts: 3,
  maxActiveSeconds: 1800,
  maxEstimatedCost: 5,
} as const;

const ENV_KEYS = {
  maxModelCalls: "DEFAULT_MAX_MODEL_CALLS",
  maxFixAttempts: "DEFAULT_MAX_FIX_ATTEMPTS",
  maxActiveSeconds: "DEFAULT_MAX_ACTIVE_SECONDS",
  maxEstimatedCost: "DEFAULT_MAX_ESTIMATED_COST_USD",
} as const;

/** Resolve each field independently; explicit zero is a limit, not an absent value. */
export function resolveRunLimits(
  stored: RunLimits,
  env: Record<string, string | undefined> = process.env,
): RunLimits {
  const result = { ...stored };
  for (const key of Object.keys(ENV_KEYS) as (keyof RunLimits)[]) {
    if (stored[key] !== null) continue;
    const raw = env[ENV_KEYS[key]]?.trim();
    const value = raw ? Number(raw) : NaN;
    const valid =
      Number.isFinite(value) &&
      value >= 0 &&
      (key === "maxEstimatedCost" ||
        (Number.isInteger(value) && value <= 2147483647));
    result[key] = valid ? value : DEFAULT_RUN_LIMITS[key];
  }
  return result;
}

/** Shared by settings reads and the immutable snapshot created for a new Run. */
export function workspaceRunLimits(row: {
  limitMaxModelCalls: number | null;
  limitMaxFixAttempts: number | null;
  limitMaxActiveSeconds: number | null;
  limitMaxEstimatedCost: number | { toString(): string } | null;
}): RunLimits {
  return resolveRunLimits({
    maxModelCalls: row.limitMaxModelCalls,
    maxFixAttempts: row.limitMaxFixAttempts,
    maxActiveSeconds: row.limitMaxActiveSeconds,
    maxEstimatedCost:
      row.limitMaxEstimatedCost === null
        ? null
        : Number(row.limitMaxEstimatedCost),
  });
}
