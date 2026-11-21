import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  RUN_EVENT_TYPES,
  RUN_STATUSES,
  ROLE_IDS,
  WORKSPACE_EVENT_TYPES,
  apiPaths,
} from "@/contracts";

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

test("오류 코드는 모두 HTTP 상태를 가지고 중복이 없다", () => {
  assert.ok(unique(ERROR_CODES));
  assert.deepEqual(
    Object.keys(ERROR_HTTP_STATUS).sort(),
    [...ERROR_CODES].sort(),
  );
  for (const status of Object.values(ERROR_HTTP_STATUS))
    assert.ok(status >= 400 && status < 600);
});

test("열거 값에 중복이 없고 API.md의 상태 수와 같다", () => {
  assert.ok(unique(RUN_STATUSES));
  assert.equal(RUN_STATUSES.length, 7);
  assert.ok(unique(ROLE_IDS));
  assert.equal(ROLE_IDS.length, 4);
  assert.ok(unique(RUN_EVENT_TYPES));
  assert.ok(unique(WORKSPACE_EVENT_TYPES));
});

test("작업 공간 이벤트는 모두 Run 이벤트 종류의 부분집합이다", () => {
  for (const type of WORKSPACE_EVENT_TYPES)
    assert.ok(RUN_EVENT_TYPES.includes(type));
});

test("API 경로는 문서의 형식을 따르고 ID를 인코딩한다", () => {
  assert.equal(apiPaths.runStream("r1"), "/api/runs/r1/stream");
  assert.equal(apiPaths.decisionResponse("d1"), "/api/decisions/d1/response");
  assert.equal(apiPaths.officeState("p/1"), "/api/projects/p%2F1/office-state");
  assert.equal(apiPaths.companyCharacter("PM"), "/api/company/characters/PM");
});
