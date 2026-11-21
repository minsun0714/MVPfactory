/** API 경로. 화면의 서비스 계층과 서버의 테스트가 같은 경로를 쓰게 한다. 기준 문서: docs/API.md */

const enc = encodeURIComponent;

export const apiPaths = {
  projects: "/api/projects",
  project: (id: string) => `/api/projects/${enc(id)}`,
  projectArchive: (id: string) => `/api/projects/${enc(id)}/archive`,
  projectUnarchive: (id: string) => `/api/projects/${enc(id)}/unarchive`,
  projectRuns: (id: string) => `/api/projects/${enc(id)}/runs`,
  projectResult: (id: string) => `/api/projects/${enc(id)}/result`,
  officeState: (id: string) => `/api/projects/${enc(id)}/office-state`,
  scopeCheck: "/api/scope-check",
  executionReadiness: "/api/runs/readiness",

  run: (id: string) => `/api/runs/${enc(id)}`,
  runPause: (id: string) => `/api/runs/${enc(id)}/pause`,
  runResume: (id: string) => `/api/runs/${enc(id)}/resume`,
  runRetry: (id: string) => `/api/runs/${enc(id)}/retry`,
  runArtifacts: (id: string) => `/api/runs/${enc(id)}/artifacts`,
  runUsage: (id: string) => `/api/runs/${enc(id)}/usage`,
  runEvents: (id: string) => `/api/runs/${enc(id)}/events`,
  runStream: (id: string) => `/api/runs/${enc(id)}/stream`,
  runMeetings: (id: string) => `/api/runs/${enc(id)}/meetings`,
  runVerification: (id: string) => `/api/runs/${enc(id)}/verification`,
  artifact: (id: string) => `/api/artifacts/${enc(id)}`,
  meeting: (id: string) => `/api/meetings/${enc(id)}`,

  decisions: "/api/decisions",
  decision: (id: string) => `/api/decisions/${enc(id)}`,
  decisionResponse: (id: string) => `/api/decisions/${enc(id)}/response`,

  workspaceStream: "/api/stream",

  company: "/api/company",
  companyCatalog: "/api/company/catalog",
  companyCharacter: (role: string) => `/api/company/characters/${enc(role)}`,
  companyOffice: "/api/company/office",

  settings: "/api/settings",
  connectionVerify: (provider: string) =>
    `/api/settings/connections/${enc(provider)}/verify`,

  health: "/api/health",
} as const;
