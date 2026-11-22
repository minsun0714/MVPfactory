/**
 * Vercel REST API로 만든 `VercelClient`. 토큰은 요청 헤더에만 쓰고 오류 메시지·로그에 넣지 않는다.
 * 변경 요청에서 응답을 받지 못하면 `OutcomeUnknownError`를 던진다.
 */
import { createHash } from "node:crypto";
import { OutcomeUnknownError } from "@/application/external-operations";
import type {
  VercelClient,
  VercelDeployment,
  VercelDeploymentState,
} from "@/application/vercel";

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

type RawDeployment = {
  id?: string;
  uid?: string;
  url: string;
  readyState?: string;
  state?: string;
  alias?: string[];
  meta?: Record<string, string>;
};

const toDeployment = (d: RawDeployment): VercelDeployment => ({
  id: (d.id ?? d.uid)!,
  url: d.url,
  state: (d.readyState ?? d.state ?? "QUEUED") as VercelDeploymentState,
  aliases: d.alias ?? [],
  meta: d.meta ?? {},
});

export function createVercelClient(options: {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): VercelClient {
  if (!options.token.trim()) throw new Error("VERCEL_TOKEN이 비어 있습니다.");
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl ?? "https://api.vercel.com").replace(/\/$/, "");

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: { json: unknown } | { raw: Buffer; headers: Record<string, string> },
    accept404 = false,
  ): Promise<T | null> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body && "json" in body
            ? { "content-type": "application/json" }
            : {}),
          ...(body && "raw" in body ? body.headers : {}),
        },
        body: !body
          ? undefined
          : "json" in body
            ? JSON.stringify(body.json)
            : new Uint8Array(body.raw),
      });
    } catch {
      if (method === "GET")
        throw new VercelApiError(0, "Vercel에 연결하지 못했어요.");
      throw new OutcomeUnknownError("Vercel 요청의 결과를 확인하지 못했어요.");
    }
    if (response.status === 404 && accept404) return null;
    const text = await response.text();
    if (!response.ok) {
      let message = "";
      try {
        message =
          (JSON.parse(text) as { error?: { message?: string } }).error
            ?.message ?? "";
      } catch {
        /* 본문이 JSON이 아니면 상태 코드만 쓴다 */
      }
      throw new VercelApiError(
        response.status,
        `Vercel 요청 실패(HTTP ${response.status})${message ? `: ${message.slice(0, 160)}` : ""}`,
      );
    }
    return text ? (JSON.parse(text) as T) : null;
  }
  const required = async <T>(...args: Parameters<typeof call>) =>
    (await call<T>(...args)) as T;
  const enc = encodeURIComponent;

  return {
    async authenticatedUsername() {
      return (await required<{ user: { username: string } }>("GET", "/v2/user"))
        .user.username;
    },

    async getProject(name) {
      const p = await call<{ id: string; name: string }>(
        "GET",
        `/v9/projects/${enc(name)}`,
        undefined,
        true,
      );
      return p ? { id: p.id, name: p.name } : null;
    },

    async createProject(name) {
      const p = await required<{ id: string; name: string }>(
        "POST",
        "/v11/projects",
        {
          json: { name, framework: "nextjs" },
        },
      );
      return { id: p.id, name: p.name };
    },

    async setProjectEnv(projectId, vars) {
      await call("POST", `/v10/projects/${enc(projectId)}/env?upsert=true`, {
        json: Object.entries(vars).map(([key, value]) => ({
          key,
          value,
          type: "plain",
          target: ["production", "preview", "development"],
        })),
      });
    },

    async uploadFile(content) {
      const sha = createHash("sha1").update(content).digest("hex");
      await call("POST", "/v2/files", {
        raw: content,
        headers: {
          "content-type": "application/octet-stream",
          "x-vercel-digest": sha,
        },
      });
      return sha;
    },

    async createDeployment(input) {
      return toDeployment(
        await required<RawDeployment>(
          "POST",
          "/v13/deployments?skipAutoDetectionConfirmation=1",
          {
            json: {
              name: input.projectName,
              project: input.projectName,
              target: "production",
              files: input.files,
              meta: input.meta,
              projectSettings: { framework: "nextjs" },
            },
          },
        ),
      );
    },

    async getDeployment(id) {
      return toDeployment(
        await required<RawDeployment>("GET", `/v13/deployments/${enc(id)}`),
      );
    },

    async findDeployment(projectId, key, value) {
      const list = await required<{ deployments: RawDeployment[] }>(
        "GET",
        `/v6/deployments?projectId=${enc(projectId)}&limit=50`,
      );
      const hit = list.deployments.find((d) => d.meta?.[key] === value);
      return hit ? toDeployment(hit) : null;
    },
  };
}

/** 최종 주소를 실제로 열어 상태 코드를 돌려준다. 리다이렉트는 따라가고, 연결하지 못하면 null */
export async function probeUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return response.status;
  } catch {
    return null;
  }
}
