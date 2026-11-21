/**
 * 외부 리소스를 바꾸는 작업(저장소·DB·배포 생성 등)을 원장(`ExternalOperation`)에 기록하며 실행한다.
 * WORKFLOW.md §10.1, ARCHITECTURE.md §9.3을 따른다.
 *
 * 핵심 규칙
 * - 같은 `operationKey`는 같은 목적의 작업이다. 이미 성공했으면 다시 호출하지 않고 저장된 결과를 돌려준다.
 * - 같은 키에 다른 대상·요청이 오면 충돌로 거절한다. 재전송하지 않는다.
 * - 요청 후 응답을 받지 못하면(`OutcomeUnknownError`) 성공·실패로 단정하지 않고 `UNKNOWN`으로 남긴다.
 * - `UNKNOWN`·`FAILED`(부작용이 남았을 수 있음)인 작업은 다시 요청하기 **전에** 실제 상태를 조회(reconcile)한다.
 *   조회로 있음이 확인되면 그것을 결과로 삼고, 없음이 확인될 때만 다시 요청한다.
 *   조회 자체가 실패하면 새로 만들지 않고 멈춘다.
 * - 같은 작업을 동시에 요청해도 외부 호출은 한 번만 일어난다.
 */
import type { Provider } from "@/contracts/settings";

export type LedgerStatus =
  "PLANNED" | "REQUESTED" | "SUCCEEDED" | "FAILED" | "UNKNOWN";

export type LedgerEntry = {
  id: string;
  operationKey: string;
  status: LedgerStatus;
  targetAccount: string;
  requestHash: string;
  externalId: string | null;
  attempt: number;
};

export type LedgerBegin = {
  operationKey: string;
  projectId: string;
  runId: string | null;
  provider: Provider;
  kind: string;
  targetAccount: string;
  requestHash: string;
};

export interface ExternalOperationStore {
  /** 원장에 없으면 `PLANNED`로 만들고, 있으면 그대로 돌려준다. */
  begin(input: LedgerBegin): Promise<LedgerEntry>;
  /** 허용한 상태에 있을 때만 `REQUESTED`로 바꿔 외부 호출 권한을 얻는다. 얻지 못하면 null */
  claim(id: string, from: LedgerStatus[]): Promise<LedgerEntry | null>;
  settle(
    id: string,
    result:
      | { status: "SUCCEEDED"; externalId: string; evidence?: unknown }
      | { status: "FAILED" | "UNKNOWN"; evidence?: unknown },
  ): Promise<void>;
  /** 요청 중이던 작업이 오래 갱신되지 않았다면(워커 종료 등) 결과 불명확로 돌린다. */
  markInterruptedUnknown(olderThanMs: number): Promise<number>;
}

/** 요청을 보냈지만 결과를 확인하지 못했다(시간 초과, 연결 끊김). 어댑터가 던진다. */
export class OutcomeUnknownError extends Error {
  constructor(message = "외부 요청의 결과를 확인하지 못했습니다.") {
    super(message);
    this.name = "OutcomeUnknownError";
  }
}

/** 같은 작업 키에 다른 대상이나 요청이 들어왔다. */
export class OperationConflictError extends Error {
  constructor(readonly operationKey: string) {
    super("같은 작업 키에 다른 대상 또는 요청 내용이 들어왔습니다.");
    this.name = "OperationConflictError";
  }
}

/** 같은 작업을 다른 곳이 이미 진행 중이다. 나중에 다시 시도한다. */
export class OperationInFlightError extends Error {
  constructor(readonly operationKey: string) {
    super("같은 외부 작업이 이미 진행 중입니다.");
    this.name = "OperationInFlightError";
  }
}

export type OperationSpec = LedgerBegin & {
  /** 외부에 변경을 요청한다. 결과를 확인하지 못했다면 `OutcomeUnknownError`를 던진다. */
  execute(): Promise<{ externalId: string; evidence?: unknown }>;
  /**
   * 요청이 실제로 반영됐는지 조회한다. 이름이 같다는 이유만으로 같은 리소스로 보지 않고,
   * 요청에 심어 둔 식별자나 이미 알고 있는 리소스 ID로 확인한다.
   */
  reconcile(): Promise<
    { found: true; externalId: string; evidence?: unknown } | { found: false }
  >;
};

export type OperationResult = {
  externalId: string;
  /** 외부 호출 없이 원장에 저장된(또는 조회로 확인한) 결과를 돌려줬는지 */
  reused: boolean;
};

export async function runExternalOperation(
  store: ExternalOperationStore,
  spec: OperationSpec,
): Promise<OperationResult> {
  const entry = await store.begin(spec);
  if (
    entry.targetAccount !== spec.targetAccount ||
    entry.requestHash !== spec.requestHash
  )
    throw new OperationConflictError(spec.operationKey);
  if (entry.status === "SUCCEEDED" && entry.externalId)
    return { externalId: entry.externalId, reused: true };

  // 이전 시도가 있었다면 부작용이 남았을 수 있으니 요청 전에 실제 상태를 먼저 조회한다.
  if (
    entry.status === "UNKNOWN" ||
    entry.status === "FAILED" ||
    entry.status === "REQUESTED"
  ) {
    const found = await spec.reconcile();
    if (found.found) {
      await store.settle(entry.id, {
        status: "SUCCEEDED",
        externalId: found.externalId,
        evidence: found.evidence,
      });
      return { externalId: found.externalId, reused: true };
    }
    // 요청 중으로 남은 작업은 다른 곳이 진행 중인지 멈춘 것인지 알 수 없다. 없음이 확인되어도 새로 시작하지 않는다.
    if (entry.status === "REQUESTED")
      throw new OperationInFlightError(spec.operationKey);
  }

  const claimed = await store.claim(entry.id, ["PLANNED", "FAILED", "UNKNOWN"]);
  if (!claimed) throw new OperationInFlightError(spec.operationKey);

  try {
    const result = await spec.execute();
    await store.settle(claimed.id, {
      status: "SUCCEEDED",
      externalId: result.externalId,
      evidence: result.evidence,
    });
    return { externalId: result.externalId, reused: false };
  } catch (error) {
    const unknown = error instanceof OutcomeUnknownError;
    await store.settle(claimed.id, {
      status: unknown ? "UNKNOWN" : "FAILED",
      evidence: {
        message: error instanceof Error ? error.message : "알 수 없는 오류",
      },
    });
    throw error;
  }
}
