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
import { checkDockerReady } from "@/infrastructure/sandbox/docker-probe";
import { checkCodexReady } from "@/infrastructure/codex/codex-writer";
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
  /** Docker 상태 확인. 문제가 있으면 사용자가 할 일을 담은 문장 목록을 돌려준다. */
  sandboxProblems?: () => Promise<string[]>;
  codexProblems?: () => Promise<string[]>;
}): Omit<IntegrationReadiness, "assess"> & {
  assess(): Promise<ReadinessAssessment>;
} {
  const now = deps.now ?? (() => new Date());
  const sandboxProblems = deps.sandboxProblems ?? (() => checkDockerReady());

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
        label: "회의 AI·개발 Codex 연결",
        undecided: ADAPTERS.llm.decided ? [] : ["DEC-002 AI 연결 방식과 모델"],
        missingAdapters: ADAPTERS.llm.implemented ? [] : ["LLM 어댑터"],
        missingCredentials: [
          ...(process.env.LLM_API_KEY?.trim() ? [] : ["LLM_API_KEY"]),
          ...(process.env.LLM_MODEL?.trim() ? [] : ["LLM_MODEL"]),
        ],
        unverifiedConnection: null,
        missingSettings: [],
        runtimeProblems: await (
          deps.codexProblems ??
          (() =>
            checkCodexReady({
              command: process.env.CODEX_CLI_PATH?.trim() || "codex",
            }))
        )(),
      },
      {
        id: "SANDBOX",
        label: "코드 실행 환경",
        undecided: ADAPTERS.sandbox.decided
          ? []
          : ["DEC-004 생성 코드 실행 환경"],
        missingAdapters: ADAPTERS.sandbox.implemented
          ? []
          : ["샌드박스 어댑터"],
        missingCredentials: [],
        unverifiedConnection: null,
        missingSettings: [],
        // 어댑터가 있어도 Docker가 꺼져 있거나 이미지가 없으면 실행할 수 없다.
        runtimeProblems: ADAPTERS.sandbox.implemented
          ? await sandboxProblems()
          : [],
      },
      provider(
        "GITHUB",
        "GitHub",
        "github",
        "저장소 생성·반영 어댑터",
        ADAPTERS.github,
      ),
      provider("VERCEL", "Vercel", "vercel", "배포 어댑터", ADAPTERS.vercel),
      {
        ...provider(
          "SUPABASE",
          "Supabase",
          "supabase",
          "DB 생성 어댑터",
          ADAPTERS.supabase,
        ),
        missingSettings: process.env.SUPABASE_PROJECT_REF?.trim()
          ? []
          : [".env의 SUPABASE_PROJECT_REF(공용 Supabase 프로젝트)"],
        // DB 필요 여부는 기획 후 결정되며 필요한 앱은 개발 전에 다시 확인한다.
        optionalBecause:
          "DB가 필요한 앱을 만들 때만 필요해요. 브라우저 저장소로 대신하지 않아요.",
      },
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
