import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertSameOrigin } from "@/server/http";
import { AppError } from "@/domain/errors";
function request(origin: string, host = "127.0.0.1:3000") {
  return new Request("http://localhost:3000/api/scope-check", {
    headers: { origin, host },
  });
}
test("browser Host matches even when Next.js reconstructs an internal localhost URL", () => {
  assert.doesNotThrow(() => assertSameOrigin(request("http://127.0.0.1:3000")));
  assert.doesNotThrow(() =>
    assertSameOrigin(request("http://localhost:3000", "localhost:3000")),
  );
});
test("foreign origins, different ports and protocols remain blocked", () => {
  for (const origin of [
    "http://evil.example",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3000",
    "null",
    "garbage",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000, http://evil.example",
  ])
    assert.throws(
      () => assertSameOrigin(request(origin)),
      (e) => e instanceof AppError && e.code === "FORBIDDEN_ORIGIN",
    );
});
test("malformed host and untrusted forwarded host do not bypass check", () => {
  assert.throws(() =>
    assertSameOrigin(request("http://evil.example", "evil.example/path")),
  );
  assert.throws(() =>
    assertSameOrigin(
      new Request("http://localhost:3000/api/scope-check", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://evil.example",
          "x-forwarded-host": "evil.example",
        },
      }),
    ),
  );
});
test("non-browser callers without Host fall back to request URL", () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(
      new Request("http://localhost:3000/api/scope-check", {
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertSameOrigin(new Request("http://localhost:3000/api/scope-check")),
  );
});
