import type { HealthRepository } from "@/application/ports";

export function createHealthUseCases(health: HealthRepository) {
  return { check: () => health.check() };
}
