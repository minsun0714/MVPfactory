import type { SourceFileInput } from "@/domain/sandbox";

/** 샌드박스 밖에 소스를 보존하는 곳. 샌드박스의 디스크는 유일한 소스 저장소가 아니다. */
export interface SourceStorage {
  /** 같은 Run·같은 내용이면 같은 참조를 돌려준다. */
  put(
    runId: string,
    sourceDigest: string,
    files: SourceFileInput[],
  ): Promise<string>;
  get(ref: string): Promise<{ path: string; content: Buffer }[]>;
}
