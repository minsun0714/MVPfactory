"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ExecutionReadiness,
  Project,
  Run,
  ScopeCheckResult,
  StartRunRequest,
} from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { officeCommands } from "@/services/office-commands";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { useOfficeList } from "@/hooks/useOfficeList";
export function useProjectOperations(
  id: string,
  refresh: () => void,
  revision?: number,
) {
  const router = useRouter();
  const project = useOfficeResource<Project>(apiPaths.project(id), revision);
  const runs = useOfficeList<Run>(apiPaths.projectRuns(id), revision);
  const command = useOfficeCommand();
  const readiness = useOfficeResource<ExecutionReadiness>(
    apiPaths.executionReadiness,
    revision,
  );
  const [feedback, setFeedback] = useState("");
  const [scope, setScope] = useState<ScopeCheckResult>();
  const [selectedRun, setSelectedRun] = useState("");
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const runId = selectedRun || project.data?.latestRun?.id || "";
  function reload() {
    project.reload();
    runs.reload();
    refresh();
  }
  function checkScope() {
    const data = project.data;
    if (data)
      void command.execute(
        () =>
          officeCommands.scope({
            idea: data.idea,
            purpose: data.purpose ?? undefined,
            constraints: data.constraints ?? undefined,
          }),
        setScope,
      );
  }
  function start() {
    const data = project.data;
    if (!data || !readiness.data?.available) return;
    const body: StartRunRequest = {
      type: data.latestRun ? "REVISION" : "INITIAL",
      mode: "REAL",
      ceoLevel: data.ceoLevel,
      ...(data.latestRun ? { feedback } : {}),
    };
    const fingerprint = JSON.stringify({ id, body });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, key: crypto.randomUUID() };
    const key = submission.current.key;
    void command.execute(
      () => officeCommands.start(id, body, key),
      (run) => {
        submission.current = null;
        setSelectedRun(run.id);
        reload();
        router.push(`/office?project=${encodeURIComponent(id)}`);
      },
    );
  }
  return {
    canRevise:
      !!project.data?.latestRun &&
      ["SUCCEEDED", "FAILED"].includes(project.data.latestRun.status) &&
      !!runs.data?.items.some((r) => r.status === "SUCCEEDED"),
    project,
    runs,
    command,
    readiness,
    feedback,
    setFeedback,
    scope,
    checkScope,
    start,
    runId,
    setSelectedRun,
    reload,
    archive: () => {
      const data = project.data;
      if (data)
        void command.execute(
          () => officeCommands.archive(id, !data.archived),
          reload,
        );
    },
  };
}
