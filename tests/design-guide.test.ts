import { strict as assert } from "node:assert";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  IMPECCABLE_VERSION,
  loadImpeccableGuide,
  markdownSection,
} from "@/infrastructure/generation-guides/impeccable";

const SOURCE = resolve("resources/generation-guides/impeccable");

test("저장소에 고정한 Impeccable 지침에서 판단 기준만 골라 버전과 함께 읽는다", async () => {
  const guide = await loadImpeccableGuide();
  assert.equal(guide.name, "Impeccable");
  assert.equal(guide.version, IMPECCABLE_VERSION);
  for (const part of [
    "Core principles:",
    "## How to design",
    "## Modes",
    "## Phase 3: Write the brief",
    "## Confirm and stop",
    "## The product slop test",
  ])
    assert.ok(guide.text.includes(part), part);
  // 이 환경에서 실행할 수 없는 설치·명령 목록은 넘기지 않는다.
  assert.ok(!guide.text.includes("## Setup"));
  assert.ok(!guide.text.includes("## Commands"));
  assert.ok(!guide.text.includes("## Phase 1: Discovery interview"));
});

test("라이선스와 출처 문서를 지침과 함께 보관한다", async () => {
  assert.match(
    await readFile(join(SOURCE, "LICENSE"), "utf8"),
    /Apache License/,
  );
  assert.match(
    await readFile(join(SOURCE, "README.md"), "utf8"),
    /skill-v4\.10\.0/,
  );
});

test("지침 버전이 고정 버전과 다르거나 필요한 절이 없으면 조용히 넘어가지 않는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guide-"));
  try {
    await cp(SOURCE, dir, { recursive: true });
    const skill = await readFile(join(dir, "SKILL.md"), "utf8");
    await writeFile(
      join(dir, "SKILL.md"),
      skill.replace(`version: ${IMPECCABLE_VERSION}`, "version: 9.9.9"),
    );
    await assert.rejects(
      loadImpeccableGuide(dir),
      /고정 버전\(4\.10\.0\)과 달라요: 9\.9\.9/,
    );
    await writeFile(
      join(dir, "SKILL.md"),
      skill.replace("## Modes", "## Mode list"),
    );
    await assert.rejects(
      loadImpeccableGuide(dir),
      /"## Modes"을 찾지 못했어요/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("절은 같은 단계 이하의 다음 제목 전까지만 자른다", () => {
  const md = "# T\n## A\na\n### A1\nb\n## B\nc";
  assert.equal(markdownSection(md, "## A"), "## A\na\n### A1\nb");
  assert.equal(markdownSection(md, "## B"), "## B\nc");
});
