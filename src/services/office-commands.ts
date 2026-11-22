import { officeRequest } from "@/services/office-api";
import { apiPaths } from "@/contracts/paths";
import type {
  Connection,
  Project,
  Run,
  ScopeCheckRequest,
  ScopeCheckResult,
  Settings,
  StartRunRequest,
  UpdateSettingsRequest,
  Provider,
} from "@/contracts";
function send<T>(path: string, method: string, body?: unknown, key?: string) {
  return officeRequest<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export const officeCommands = {
  scope: (body: ScopeCheckRequest) =>
    send<ScopeCheckResult>(apiPaths.scopeCheck, "POST", body),
  start: (id: string, body: StartRunRequest, key: string) =>
    send<Run>(apiPaths.projectRuns(id), "POST", body, key),
  archive: (id: string, archived: boolean) =>
    send<Project>(
      archived ? apiPaths.projectArchive(id) : apiPaths.projectUnarchive(id),
      "POST",
    ),
  control: (id: string, action: "pause" | "resume" | "retry") =>
    send<Run>(
      {
        pause: apiPaths.runPause,
        resume: apiPaths.runResume,
        retry: apiPaths.runRetry,
      }[action](id),
      "POST",
    ),
  settings: (body: UpdateSettingsRequest) =>
    send<Settings>(apiPaths.settings, "PUT", body),
  verify: (provider: Provider) =>
    send<Connection>(apiPaths.connectionVerify(provider), "POST"),
};
