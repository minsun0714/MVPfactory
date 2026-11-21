import type { ConnectionProbe } from "@/application/ports";
import type { Connection, Provider } from "@/contracts";
import { AppError } from "@/domain/errors";
import {
  credentialEnvName,
  readCredential,
} from "@/infrastructure/integrations/credentials";

type Fetch = typeof fetch;

type Endpoint = {
  url: string;
  /** 응답 본문에서 대상 이름을 읽는다 */
  target: (body: unknown) => string | null;
};

const ENDPOINTS: Record<Provider, Endpoint> = {
  github: {
    url: "https://api.github.com/user",
    target: (body) => stringField(body, "login"),
  },
  vercel: {
    url: "https://api.vercel.com/v2/user",
    target: (body) =>
      stringField((body as { user?: unknown } | null)?.user, "username") ??
      stringField((body as { user?: unknown } | null)?.user, "name"),
  },
  supabase: {
    url: "https://api.supabase.com/v1/organizations",
    target: (body) =>
      Array.isArray(body) && body.length > 0
        ? (stringField(body[0], "name") ?? `조직 ${body.length}개`)
        : null,
  },
};

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : null;
}

const READ_ONLY_NOTE =
  "읽기 확인만 수행했습니다. 저장소·프로젝트 생성 같은 쓰기 권한은 실제 작업 때 확인합니다.";

/**
 * 공급자의 읽기 전용 API를 한 번 호출해 비밀 키가 유효한지 확인한다.
 * 비밀 키는 요청 헤더로만 보내며 응답·로그·오류 메시지에 담지 않는다.
 */
export function createConnectionProbe(
  fetchImpl: Fetch = fetch,
  now: () => Date = () => new Date(),
): ConnectionProbe {
  return {
    async check(provider): Promise<Connection> {
      const checkedAt = now().toISOString();
      const token = readCredential(provider);
      if (!token)
        return {
          provider,
          status: "NOT_CONNECTED",
          target: null,
          checkedAt,
          message: `.env에 ${credentialEnvName(provider)}를 설정한 뒤 다시 확인하세요.`,
        };
      const endpoint = ENDPOINTS[provider];
      let response: Response;
      try {
        response = await fetchImpl(endpoint.url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "mvp-factory",
          },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        // 응답을 받지 못했으므로 연결 상태를 바꾸지 않고 다시 시도하게 한다.
        throw new AppError(
          "SERVICE_UNAVAILABLE",
          "공급자에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
          {
            retryable: true,
          },
        );
      }
      if (response.ok) {
        const body: unknown = await response.json().catch(() => null);
        return {
          provider,
          status: "CONNECTED",
          target: endpoint.target(body),
          checkedAt,
          message: READ_ONLY_NOTE,
        };
      }
      if (response.status === 401)
        return {
          provider,
          status: "DISCONNECTED",
          target: null,
          checkedAt,
          message:
            "비밀 키가 만료되었거나 철회되었습니다. .env의 값을 새로 발급해 바꾸세요.",
        };
      if (response.status === 403)
        return {
          provider,
          status: "INSUFFICIENT_PERMISSION",
          target: null,
          checkedAt,
          message: "비밀 키에 필요한 권한이 없습니다. 권한 범위를 확인하세요.",
        };
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "공급자가 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.",
        {
          retryable: true,
        },
      );
    },
  };
}
