import { execFileSync } from "node:child_process";

/** Docker와 샌드박스 이미지가 있어야 하는 테스트를 건너뛸지 판단한다(동기). */
export function dockerSkipReason(image = "node:22-slim"): string | false {
  try {
    execFileSync("docker", ["image", "inspect", image], {
      stdio: "ignore",
      timeout: 10_000,
    });
    return false;
  } catch {
    return `Docker 또는 이미지 ${image}를 사용할 수 없어 건너뜁니다. (docker pull ${image})`;
  }
}
