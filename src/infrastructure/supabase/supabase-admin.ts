/**
 * Supabase 관리 API(https://api.supabase.com)로 만든 `SupabaseAdmin`.
 * 관리 토큰은 요청 헤더에만 쓰고 오류·로그에 넣지 않는다. 변경 요청의 연결 끊김은 `OutcomeUnknownError`.
 */
import type { SupabaseAdmin } from "@/application/app-database";
import { OutcomeUnknownError } from "@/application/external-operations";

export class SupabaseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseApiError";
  }
}

export function createSupabaseAdmin(options: {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SupabaseAdmin {
  if (!options.token.trim())
    throw new Error("SUPABASE_ACCESS_APP_TOKEN이 비어 있습니다.");
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl ?? "https://api.supabase.com").replace(
    /\/$/,
    "",
  );
  const enc = encodeURIComponent;

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (method === "GET")
        throw new SupabaseApiError(0, "Supabase에 연결하지 못했어요.");
      throw new OutcomeUnknownError(
        "Supabase 요청의 결과를 확인하지 못했어요.",
      );
    }
    const text = await response.text();
    if (!response.ok) {
      let message = "";
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? "";
      } catch {
        /* 본문이 JSON이 아니면 상태 코드만 쓴다 */
      }
      throw new SupabaseApiError(
        response.status,
        `Supabase 요청 실패(HTTP ${response.status})${message ? `: ${message.slice(0, 200)}` : ""}`,
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    async query(ref, sql) {
      const rows = await call<Record<string, unknown>[] | null>(
        "POST",
        `/v1/projects/${enc(ref)}/database/query`,
        { query: sql },
      );
      return Array.isArray(rows) ? rows : [];
    },
    async exposedSchemas(ref) {
      const config = await call<{ db_schema: string }>(
        "GET",
        `/v1/projects/${enc(ref)}/postgrest`,
      );
      return config.db_schema
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    },
    async setExposedSchemas(ref, schemas) {
      await call("PATCH", `/v1/projects/${enc(ref)}/postgrest`, {
        db_schema: schemas.join(","),
      });
    },
    async anonKey(ref) {
      const keys = await call<{ name: string; api_key: string | null }[]>(
        "GET",
        `/v1/projects/${enc(ref)}/api-keys`,
      );
      const anon = keys.find((k) => k.name === "anon")?.api_key;
      if (!anon)
        throw new SupabaseApiError(404, "공개(anon) 키를 찾지 못했어요.");
      return anon;
    },
  };
}

/** 배포된 앱과 같은 공개(anon) 키로 앱 데이터 API를 읽어 본다. 연결하지 못하면 null */
export async function probeAppData(
  input: { url: string; anonKey: string; schema: string; table: string },
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(
      `${input.url}/rest/v1/${encodeURIComponent(input.table)}?select=id&limit=1`,
      {
        headers: {
          apikey: input.anonKey,
          authorization: `Bearer ${input.anonKey}`,
          "accept-profile": input.schema,
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    return response.status;
  } catch {
    return null;
  }
}
