/**
 * 실제 실행 구성(Composition Root). `.env`에 LLM 키와 모델이 있을 때만 만든다.
 * 없으면 null이며, 그때 REAL Run은 준비되지 않은 상태로 막힌다(가짜 성공으로 대체하지 않는다).
 */
import { readTokenPrice } from "@/application/metered-model";
import { createRedactor } from "@/domain/secrets";
import { createGitHubClient } from "@/infrastructure/github/github-client";
import { createOpenAiModel } from "@/infrastructure/llm/openai-model";
import { createCodexWriter } from "@/infrastructure/codex/codex-writer";
import { createAppDatabaseStore } from "@/infrastructure/prisma/app-database-store";
import {
  createSupabaseAdmin,
  probeAppData,
} from "@/infrastructure/supabase/supabase-admin";
import {
  createVercelClient,
  probeUrl,
} from "@/infrastructure/vercel/vercel-client";
import type { Connection, Provider } from "@/contracts/settings";
import { createSettingsRepository } from "@/infrastructure/prisma/settings-repository";
import { db } from "@/lib/db";
import { SANDBOX_IMAGE } from "@/infrastructure/sandbox/docker-probe";
import { createDockerSandbox } from "@/infrastructure/sandbox/docker-sandbox";
import { createLocalSourceStorage } from "@/infrastructure/storage/local-source-storage";
import type { WorkerRuntimeOptions } from "@/server/worker-runtime";

export function createRealExecutionConfig(
  env: Record<string, string | undefined>,
  secrets: (string | undefined | null)[],
): WorkerRuntimeOptions["real"] | null {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!apiKey || !model) return null;
  return {
    model: createOpenAiModel({ apiKey, model }),
    codeWriter: createCodexWriter({
      command: env.CODEX_CLI_PATH?.trim() || "codex",
      model: env.CODEX_MODEL?.trim() || undefined,
      secrets,
    }),
    price: readTokenPrice(env),
    sandbox: createDockerSandbox({
      image: SANDBOX_IMAGE,
      redact: createRedactor(secrets),
    }),
    storage: createLocalSourceStorage(
      env.SOURCE_SNAPSHOT_DIR?.trim() || ".data/source-snapshots",
    ),
    secrets,
    release: env.GITHUB_TOKEN?.trim()
      ? {
          github: {
            client: createGitHubClient({ token: env.GITHUB_TOKEN.trim() }),
            // 대상은 공통 설정에 저장된 연결 계정과 공개 범위에서만 읽는다.
            async target() {
              const settings = await createSettingsRepository(db).get();
              const owner = connected(settings.connections, "github");
              return owner
                ? { owner, isPrivate: settings.repoVisibility === "PRIVATE" }
                : null;
            },
          },
          vercel: env.VERCEL_TOKEN?.trim()
            ? {
                client: createVercelClient({ token: env.VERCEL_TOKEN.trim() }),
                owner: async () =>
                  connected(
                    (await createSettingsRepository(db).get()).connections,
                    "vercel",
                  ),
                probe: (url: string) => probeUrl(url),
              }
            : undefined,
          // 공용 Supabase 프로젝트(DEC-005). DB가 필요한 앱에서만 쓴다.
          supabase:
            env.SUPABASE_ACCESS_APP_TOKEN?.trim() &&
            env.SUPABASE_PROJECT_REF?.trim()
              ? {
                  admin: createSupabaseAdmin({
                    token: env.SUPABASE_ACCESS_APP_TOKEN.trim(),
                  }),
                  store: createAppDatabaseStore(db),
                  projectRef: env.SUPABASE_PROJECT_REF.trim(),
                  owner: async () =>
                    connected(
                      (await createSettingsRepository(db).get()).connections,
                      "supabase",
                    ),
                  probe: probeAppData,
                }
              : undefined,
        }
      : undefined,
  };
}

/** 연결 확인에 성공해 저장된 대상 계정. 연결되지 않았으면 null */
function connected(
  connections: Connection[],
  provider: Provider,
): string | null {
  const found = connections.find((c) => c.provider === provider);
  return found?.status === "CONNECTED" && found.target ? found.target : null;
}
