/**
 * 생성 앱 디자이너가 따를 Impeccable 지침을 저장소에 고정한 파일에서 읽는다.
 *
 * 사용자 PC에 설치된 스킬을 읽지 않는다(버전이 바뀌어도 모르고 다른 환경에서 재현되지 않는다).
 * 이 환경에서 실행할 수 없는 부분(설치·명령·스크립트 목록)은 빼고 판단 기준만 넘긴다.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DesignGuide } from "@/application/agents";

/** 고정한 지침 버전. resources/generation-guides/impeccable/README.md와 함께 바꾼다. */
export const IMPECCABLE_VERSION = "4.10.0";
const DEFAULT_DIR = resolve("resources/generation-guides/impeccable");

/** `## 제목`부터 다음 `## ` 제목 전까지. 없으면 오류(지침 형식이 바뀐 것을 조용히 넘기지 않는다). */
export function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1)
    throw new Error(`디자인 지침에서 "${heading}"을 찾지 못했어요.`);
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const end = lines.findIndex(
    (line, i) =>
      i > start &&
      /^#+ /.test(line) &&
      (line.match(/^#+/)?.[0].length ?? 0) <= level,
  );
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

/** 머리말 뒤부터 첫 `## ` 제목 전까지(소개와 핵심 원칙) */
function preamble(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const end = body.search(/^## /m);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

export async function loadImpeccableGuide(
  dir: string = DEFAULT_DIR,
): Promise<DesignGuide> {
  const [skill, shape, operate] = await Promise.all(
    ["SKILL.md", "shape.md", "operate.md"].map((name) =>
      readFile(join(dir, name), "utf8"),
    ),
  );
  const version = skill.match(/^\s+version:\s*([\d.]+)\s*$/m)?.[1];
  if (version !== IMPECCABLE_VERSION)
    throw new Error(
      `Impeccable 지침 버전이 고정 버전(${IMPECCABLE_VERSION})과 달라요: ${version ?? "확인 불가"}. resources/generation-guides/impeccable/README.md를 확인하세요.`,
    );
  const text = [
    preamble(skill),
    markdownSection(skill, "## How to design"),
    markdownSection(skill, "## Modes"),
    markdownSection(shape, "## Phase 3: Write the brief"),
    markdownSection(shape, "## Confirm and stop"),
    operate.trim(),
  ].join("\n\n");
  return { name: "Impeccable", version, text };
}
