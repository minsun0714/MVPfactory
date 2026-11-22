/**
 * 생성 코드를 설치·빌드·테스트하는 격리 환경(Port). 구현은 `src/infrastructure/sandbox`에 있다.
 *
 * 지켜야 할 약속
 * - 팩토리의 비밀값과 호스트 파일을 보지 못한다.
 * - 외부 통신은 의존성 설치 단계에만 허용하고, 빌드·테스트 단계는 `cutNetwork()` 뒤에 실행한다.
 * - 자원(메모리·CPU·프로세스·시간)에 상한이 있다.
 * - 세션이 끝나면(`dispose`) 환경과 파일이 사라진다. 샌드박스 디스크는 유일한 소스 저장소가 아니다.
 */
import type { SourceFileInput } from "@/domain/sandbox";

export type CommandResult = {
  command: string[];
  /** 종료 코드. 시간 초과로 강제 종료됐다면 null */
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** 비밀값을 가린 출력. 한도를 넘으면 끝부분만 남는다. */
  stdout: string;
  stderr: string;
  truncated: boolean;
};

export type ExportedFile = { path: string; content: Buffer };

export interface SandboxSession {
  readonly id: string;
  /** 작업 공간에 파일을 쓴다. 경로·크기 규칙을 어기면 `SandboxPolicyError` */
  writeFiles(files: SourceFileInput[]): Promise<void>;
  /** `env`는 이 명령에만 넣는 환경변수다. 비밀값을 넣지 않는다. */
  run(
    command: string[],
    options?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<CommandResult>;
  /** 이후의 명령은 외부 통신을 할 수 없다. 되돌릴 수 없다. */
  cutNetwork(): Promise<void>;
  /** 작업 공간의 파일을 꺼낸다(의존성·빌드 산출물 폴더는 제외). */
  exportFiles(): Promise<ExportedFile[]>;
  dispose(): Promise<void>;
}

export interface Sandbox {
  open(options: { runId: string }): Promise<SandboxSession>;
  /** 오래 남은 샌드박스(워커 종료 등으로 정리되지 못한 것)를 지우고 지운 개수를 돌려준다. */
  cleanupStale(olderThanMs: number): Promise<number>;
}
