import type { Provider } from "@/contracts/settings";

/** 공급자별 비밀 키의 환경변수 이름. 값은 이 모듈 밖으로 내보내지 않는다. */
const ENV_NAMES: Record<Provider, string> = {
  github: "GITHUB_TOKEN",
  vercel: "VERCEL_TOKEN",
  supabase: "SUPABASE_ACCESS_TOKEN",
};

export function credentialEnvName(provider: Provider): string {
  return ENV_NAMES[provider];
}

export function hasCredential(provider: Provider): boolean {
  return Boolean(process.env[ENV_NAMES[provider]]?.trim());
}

export function readCredential(provider: Provider): string | null {
  return process.env[ENV_NAMES[provider]]?.trim() || null;
}
