export class IntegrationNotConfiguredError extends Error {
  constructor(name: string) {
    super(`${name} 연동이 구현 및 설정되지 않았습니다.`);
    this.name = "IntegrationNotConfiguredError";
  }
}

export interface Integrations {
  generateWithLLM(): Promise<never>;
  provisionAppDatabase(): Promise<never>;
  publishRepository(): Promise<never>;
  deploy(): Promise<never>;
}

export const integrations: Integrations = {
  async generateWithLLM() { throw new IntegrationNotConfiguredError("LLM"); },
  async provisionAppDatabase() { throw new IntegrationNotConfiguredError("Supabase"); },
  async publishRepository() { throw new IntegrationNotConfiguredError("GitHub"); },
  async deploy() { throw new IntegrationNotConfiguredError("Vercel"); },
};
