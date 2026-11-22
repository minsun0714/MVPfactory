import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { SourceStorage } from "@/application/source-storage";
import { toBytes } from "@/domain/sandbox";

/** 로컬 디스크에 JSON으로 보존한다. 참조는 `rootDir` 기준 상대 경로이며 밖으로 나갈 수 없다. */
export function createLocalSourceStorage(rootDir: string): SourceStorage {
  const root = resolve(rootDir);
  const inside = (ref: string) => {
    const full = resolve(root, ref);
    if (!full.startsWith(root + sep))
      throw new Error("허용되지 않은 보존 경로입니다.");
    return full;
  };
  return {
    async put(runId, sourceDigest, files) {
      if (!/^[A-Za-z0-9_-]+$/.test(runId) || !/^[a-f0-9]+$/.test(sourceDigest))
        throw new Error("보존 키가 올바르지 않습니다.");
      const ref = join(runId, `${sourceDigest}.json`);
      const target = inside(ref);
      await mkdir(dirname(target), { recursive: true });
      const body = JSON.stringify(
        files.map((file) => ({
          path: file.path,
          base64: Buffer.from(toBytes(file.content)).toString("base64"),
        })),
      );
      // 쓰는 도중 끊겨도 반쯤 쓴 파일이 남지 않도록 임시 파일에 쓰고 옮긴다.
      const temp = `${target}.${process.pid}.tmp`;
      await writeFile(temp, body, { mode: 0o600 });
      await rename(temp, target);
      return ref;
    },
    async get(ref) {
      const parsed = JSON.parse(await readFile(inside(ref), "utf8")) as {
        path: string;
        base64: string;
      }[];
      return parsed.map((file) => ({
        path: file.path,
        content: Buffer.from(file.base64, "base64"),
      }));
    },
  };
}
