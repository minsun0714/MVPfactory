/** 시스템 상태 계약. 기준 문서: docs/API.md §11 */
import type { IsoDateTime } from "@/contracts/common";

/** 실행 접수와 동일한 서버 준비 상태. 계정 연결 상태와는 별개다. */
export type ExecutionReadiness = { available: boolean; reason: string | null };

export type Health = {
  web: "OK";
  database: "OK" | "DOWN";
  /** 최근 heartbeat 기준 */
  worker: "OK" | "DOWN" | "UNKNOWN";
  checkedAt: IsoDateTime;
};
