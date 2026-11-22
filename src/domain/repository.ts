import { createHash } from "node:crypto";

/** 결정적인 저장소 이름. 같은 프로젝트는 재시도해도 항상 같은 이름이다. */
export function repositoryNameFor(
  projectName: string,
  projectId: string,
): string {
  const slug = projectName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  // 한글처럼 영문으로 바꿀 수 없는 이름은 `app`으로 두고, 프로젝트 ID 끝부분으로 구분한다.
  const suffix = projectId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-8);
  return `mvp-${slug || "app"}-${suffix}`;
}

/** 저장소 설명에 심는 식별자. 이름이 같다는 이유만으로 우리 저장소로 보지 않기 위해 쓴다. */
export const repositoryMarker = (projectId: string) =>
  `mvpfactory:project=${projectId}`;

/** 커밋 메시지 끝에 붙이는 소스 식별자. 커밋이 반영됐는지 조회할 때 쓴다. */
export const commitDigestLine = (sourceDigest: string) =>
  `Source-Digest: ${sourceDigest}`;

/** 요청 내용의 안정적인 해시(키 순서와 무관) */
export function stableHash(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : input;
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}
