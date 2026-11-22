import { docker } from "@/infrastructure/sandbox/docker-cli";

/** 샌드박스에 쓸 이미지. 설정이 없으면 이 이미지를 쓴다(주 버전을 고정한다). */
export const SANDBOX_IMAGE =
  process.env.SANDBOX_IMAGE?.trim() || "node:22-slim";

/**
 * Docker가 실제로 쓸 수 있는 상태인지 확인한다. 문제가 있으면 사용자가 할 일을 담은 문장으로 돌려준다.
 * 어댑터 코드가 있어도 Docker가 꺼져 있거나 이미지가 없으면 실행할 수 없으므로 준비 상태에 반영한다.
 */
export async function checkDockerReady(
  image: string = SANDBOX_IMAGE,
): Promise<string[]> {
  try {
    const server = await docker(
      ["version", "--format", "{{.Server.Version}}"],
      { timeoutMs: 8000 },
    );
    if (server.code !== 0)
      return ["Docker가 실행 중이 아니에요. Docker Desktop을 켜 주세요"];
    const found = await docker(
      ["image", "inspect", "--format", "{{.Id}}", image],
      { timeoutMs: 8000 },
    );
    if (found.code !== 0)
      return [
        `샌드박스 이미지 ${image}가 없어요. docker pull ${image}를 실행하세요`,
      ];
    return [];
  } catch {
    return ["Docker를 사용할 수 없어요. Docker가 설치되어 있는지 확인하세요"];
  }
}
