import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_SANDBOX_LIMITS,
  SandboxPolicyError,
  assertSafeSourcePath,
  assertSourceWithinLimits,
  computeSourceDigest,
  tailOutput,
} from "@/domain/sandbox";
import { decodeTar, encodeTar } from "@/infrastructure/sandbox/tar";

const rejects = (fn: () => void) => assert.throws(fn, SandboxPolicyError);

test("작업 공간 밖으로 나가거나 환경을 깨뜨리는 경로는 거부한다", () => {
  for (const path of [
    "",
    "/etc/passwd",
    "../x",
    "a/../../x",
    "a//b",
    "./a",
    "a/./b",
    "a\\b",
    "a\0b",
    "a/",
    "x".repeat(300),
  ])
    rejects(() => assertSafeSourcePath(path));
  for (const path of [
    "package.json",
    "src/app/page.tsx",
    "한글/파일.md",
    ".github/workflows/ci.yml",
  ])
    assertSafeSourcePath(path);
});

test("소스의 개수·크기·중복을 제한한다", () => {
  const limits = { ...DEFAULT_SANDBOX_LIMITS, maxFiles: 2, maxSourceBytes: 10 };
  assertSourceWithinLimits([{ path: "a", content: "12345" }], limits);
  rejects(() => assertSourceWithinLimits([], limits));
  rejects(() =>
    assertSourceWithinLimits(
      [
        { path: "a", content: "1" },
        { path: "b", content: "1" },
        { path: "c", content: "1" },
      ],
      limits,
    ),
  );
  rejects(() =>
    assertSourceWithinLimits([{ path: "a", content: "123456789012" }], limits),
  );
  rejects(() =>
    assertSourceWithinLimits(
      [
        { path: "a", content: "1" },
        { path: "a", content: "2" },
      ],
      limits,
    ),
  );
});

test("소스 식별자는 파일 순서와 무관하고 내용이 바뀌면 달라진다", () => {
  const a = { path: "a.ts", content: "1" };
  const b = { path: "b.ts", content: new TextEncoder().encode("2") };
  assert.equal(computeSourceDigest([a, b]), computeSourceDigest([b, a]));
  assert.equal(
    computeSourceDigest([a, b]),
    computeSourceDigest([{ ...a, content: new TextEncoder().encode("1") }, b]),
  );
  assert.notEqual(
    computeSourceDigest([a, b]),
    computeSourceDigest([{ ...a, content: "다름" }, b]),
  );
  assert.notEqual(
    computeSourceDigest([a]),
    computeSourceDigest([{ path: "c.ts", content: "1" }]),
  );
});

test("출력이 한도를 넘으면 끝부분만 남긴다", () => {
  assert.deepEqual(tailOutput("짧다", 100), { text: "짧다", truncated: false });
  const result = tailOutput("앞부분\n" + "x".repeat(50) + "\n오류 끝", 20);
  assert.equal(result.truncated, true);
  assert.ok(result.text.endsWith("오류 끝"));
  assert.ok(
    Buffer.byteLength(result.text) <= 20 + 3,
    "한글 경계를 감안해도 한도 근처여야 한다",
  );
});

test("tar 인코딩은 디코딩하면 그대로 돌아오고, 긴 경로와 빈 파일과 바이너리도 다룬다", () => {
  const long = `${"depth/".repeat(20)}file-name-that-is-fairly-long.ts`;
  assert.ok(Buffer.byteLength(long) > 100 && Buffer.byteLength(long) < 255);
  const files = [
    { path: "package.json", content: '{"name":"한글"}' },
    { path: "empty.txt", content: "" },
    { path: long, content: "긴 경로" },
    { path: "bin/data.bin", content: new Uint8Array([0, 255, 1, 2, 3, 128]) },
    { path: "exact512.txt", content: "a".repeat(512) },
  ];
  const decoded = decodeTar(encodeTar(files));
  assert.deepEqual(
    decoded.map((f) => f.path),
    files.map((f) => f.path),
  );
  assert.equal(decoded[0].content.toString("utf8"), '{"name":"한글"}');
  assert.equal(decoded[1].content.byteLength, 0);
  assert.equal(decoded[2].content.toString("utf8"), "긴 경로");
  assert.deepEqual([...decoded[3].content], [0, 255, 1, 2, 3, 128]);
  assert.equal(decoded[4].content.byteLength, 512);
  assert.throws(
    () => encodeTar([{ path: "a/".repeat(140) + "x", content: "" }]),
    /경로가 너무 깁니다/,
  );
});
