import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRunUseCases } from "@/application/runs";
import type { RunRepository } from "@/application/ports";
import type { Run } from "@/contracts";
import { AppError } from "@/domain/errors";

function fixture(available: boolean, mode: "REAL" | "DEMO" = "REAL") {
  const writes: string[] = [];
  const run = { id: "run", mode } as Run;
  const repository = {
    find: async () => run,
    start: async () => {
      writes.push("start");
      return run;
    },
    resume: async () => {
      writes.push("resume");
      return run;
    },
    retry: async () => {
      writes.push("retry");
      return run;
    },
  } as unknown as RunRepository;
  return {
    writes,
    service: createRunUseCases(repository, {
      isRealModeAvailable: async () => available,
    }),
  };
}
const body = { type: "INITIAL", mode: "REAL", ceoLevel: "DELEGATE" };
const code = (value: string) => (e: unknown) =>
  e instanceof AppError && e.code === value;

test("new demo requests are rejected before any run/job is created", async () => {
  const { service, writes } = fixture(true);
  await assert.rejects(
    service.start("project", { ...body, mode: "DEMO" }, "request-key"),
    code("VALIDATION_FAILED"),
  );
  assert.deepEqual(writes, []);
});
test("readiness and actual start enforce the same unavailable state", async () => {
  const { service, writes } = fixture(false);
  const readiness = await service.availability();
  assert.equal(readiness.available, false);
  assert.ok(readiness.reason);
  await assert.rejects(
    service.start("project", body, "request-key"),
    code("INTEGRATION_NOT_CONFIGURED"),
  );
  assert.deepEqual(writes, []);
});
test("ready execution starts without substituting a demo", async () => {
  const { service, writes } = fixture(true);
  assert.equal((await service.availability()).available, true);
  assert.equal(
    (await service.start("project", body, "request-key")).mode,
    "REAL",
  );
  assert.deepEqual(writes, ["start"]);
});
test("historical demo records remain readable but cannot resume or retry", async () => {
  const { service, writes } = fixture(true, "DEMO");
  assert.equal((await service.get("run")).mode, "DEMO");
  for (const action of ["resume", "retry"] as const)
    await assert.rejects(service[action]("run"), code("INVALID_RUN_STATE"));
  assert.deepEqual(writes, []);
});
test("real resume and retry also require execution readiness", async () => {
  const { service, writes } = fixture(false);
  for (const action of ["resume", "retry"] as const)
    await assert.rejects(
      service[action]("run"),
      code("INTEGRATION_NOT_CONFIGURED"),
    );
  assert.deepEqual(writes, []);
});
