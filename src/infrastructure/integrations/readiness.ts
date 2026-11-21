import type {
  IntegrationReadiness,
  SettingsRepository,
} from "@/application/ports";
import type { Connection, Provider } from "@/contracts";
import {
  evaluateReadiness,
  type ReadinessAssessment,
  type RequirementFacts,
} from "@/domain/readiness";
import { ADAPTERS } from "@/infrastructure/integrations/adapters";
import {
  credentialEnvName,
  hasCredential,
} from "@/infrastructure/integrations/credentials";

/** 연결 확인은 이 시간 안의 것만 인정한다. 오래된 확인은 권한이 바뀌었을 수 있다. */
const CONNECTION_FRESH_MS = 24 * 60 * 60 * 1000;

function connectionBlocker(
  provider: Provider,
  connections: Connection[],
  now: Date,
): string | null {
  const connection = connections.find((item) => item.provider === provider);
  if (!connection || connection.status === "NOT_CONNECTED")
    return "연결 확인을 아직 하지 않았어요";
  if (connection.status === "INSUFFICIENT_PERMISSION")
    return "필요한 권한이 부족해요";
  if (connection.status === "DISCONNECTED") return "연결이 해제되었어요";
  if (
    !connection.checkedAt ||
    now.getTime() - Date.parse(connection.checkedAt) > CONNECTION_FRESH_MS
  )
    return "연결 확인이 오래되었어요. 다시 확인하세요";
  return null;
}

/**
 * 실제 필요한 어댑터·결정·자격 증명·연결 확인·한도 설정을 모두 확인해 준비 상태를 계산한다.
 * 토큰이 있다는 것만으로 준비 완료로 보지 않는다. 비밀값은 읽지 않고 설정 여부(이름)만 본다.
 */
export function createIntegrationReadiness(deps: {
  settings: SettingsRepository;
  now?: () => Date;
}): Omit<IntegrationReadiness, "assess"> & {
  assess(): Promise<ReadinessAssessment>;
} {
  const now = deps.now ?? (() => new Date());

  async function assess() {
    const settings = await deps.settings.get();
    const provider = (
      id: RequirementFacts["id"],
      label: string,
      key: Provider,
      adapterName: string,
      adapter: {
        implemented: boolean;
        decided: boolean;
        decision: string | null;
      },
    ): RequirementFacts => ({
      id,
      label,
      undecided: adapter.decided || !adapter.decision ? [] : [adapter.decision],
      missingAdapters: adapter.implemented ? [] : [adapterName],
      missingCredentials: hasCredential(key) ? [] : [credentialEnvName(key)],
      unverifiedConnection: connectionBlocker(key, settings.connections, now()),
      missingSettings: [],
    });

    const limitSettings: string[] = [];
    if (settings.limits.maxModelCalls === null)
      limitSettings.push("모델 호출 횟수 한도");
    if (settings.limits.maxEstimatedCost === null)
      limitSettings.push("예상 비용 한도");

    return evaluateReadiness([
      {
        id: "LLM",
        label: "AI 연결",
        undecided: ADAPTERS.llm.decided ? [] : [ADAPTERS.llm.decision],
        missingAdapters: ADAPTERS.llm.implemented ? [] : ["LLM 어댑터"],
        missingCredentials: process.env.LLM_API_KEY?.trim()
          ? []
          : ["LLM_API_KEY"],
        unverifiedConnection: null,
        missingSettings: [],
      },
      {
        id: "SANDBOX",
        label: "코드 실행 환경",
        undecided: ADAPTERS.sandbox.decided ? [] : [ADAPTERS.sandbox.decision],
        missingAdapters: ADAPTERS.sandbox.implemented
          ? []
          : ["샌드박스 어댑터"],
        missingCredentials: [],
        unverifiedConnection: null,
        missingSettings: [],
      },
      provider(
        "GITHUB",
        "GitHub",
        "github",
        "저장소 생성·반영 어댑터",
        ADAPTERS.github,
      ),
      provider("VERCEL", "Vercel", "vercel", "배포 어댑터", ADAPTERS.vercel),
      provider(
        "SUPABASE",
        "Supabase",
        "supabase",
        "DB 생성 어댑터",
        ADAPTERS.supabase,
      ),
      {
        id: "LIMITS",
        label: "실행 한도",
        undecided: [],
        missingAdapters: [],
        missingCredentials: [],
        unverifiedConnection: null,
        missingSettings: limitSettings,
      },
    ]);
  }

  return {
    assess,
    async isRealModeAvailable() {
      return (await assess()).available;
    },
  };
}
