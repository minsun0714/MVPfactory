"use client";
import { useCallback, useEffect, useState } from "react";
import { SSE } from "@/contracts/events";
import { apiPaths } from "@/contracts/paths";
import type { DecisionSummary, OfficeState, ProjectSummary } from "@/contracts";
import type { OfficePanel } from "@/components/office/office-model";
import { officeApi, officeError } from "@/services/office-api";

export function useOfficeWorkspace(suspendAutoPanels = false) {
  const [pendingCommands, setPendingCommands] = useState(0);
  useEffect(() => {
    const update = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "number")
        setPendingCommands((n) => Math.max(0, n + event.detail));
    };
    window.addEventListener("office-command", update);
    return () => window.removeEventListener("office-command", update);
  }, []);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [missingProject, setMissingProject] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<{
    id: string;
    data?: OfficeState;
    error?: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<OfficePanel | "decision">(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("panel") !== "settings")
      return;
    const timer = setTimeout(() => setPanel("settings"), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      officeApi.projects(controller.signal),
      officeApi.decisions(controller.signal),
    ])
      .then(([items, open]) => {
        if (controller.signal.aborted) return;
        setProjects(items);
        setDecisions(open);
        setListError(null);
        setListLoading(false);
        const requested = new URL(window.location.href).searchParams.get(
          "project",
        );
        const missing = !!requested && !items.some((p) => p.id === requested);
        setMissingProject(missing);
        setSelectedId((previous) =>
          requested
            ? missing
              ? null
              : requested
            : items.some((p) => p.id === previous)
              ? previous
              : (items[0]?.id ?? null),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setListError(officeError(error));
          setListLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    officeApi
      .state(selectedId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSnapshot({ id: selectedId, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot((previous) => ({
            id: selectedId,
            data: previous?.id === selectedId ? previous.data : undefined,
            error: officeError(error),
          }));
      });
    return () => controller.abort();
  }, [selectedId, revision]);
  const state = snapshot?.id === selectedId ? snapshot.data : undefined;
  const stateError = snapshot?.id === selectedId ? snapshot.error : undefined;
  const runId = state?.run?.id;
  const sequence = state?.lastSequence;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, 250);
    };
    const workspace = new EventSource(apiPaths.workspaceStream);
    workspace.addEventListener(SSE.workspaceEventName, invalidate);
    workspace.onopen = () => {
      setConnection("connected");
      invalidate();
    };
    workspace.onerror = () => setConnection("reconnecting");
    // Polling also recovers workspace events lost across reconnects.
    const interval = setInterval(refresh, 15000);
    return () => {
      workspace.close();
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!runId || sequence === undefined) return;
    let cursor = sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stream = new EventSource(
      `${apiPaths.runStream(runId)}?after=${sequence}`,
    );
    const invalidate = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, 250);
    };
    stream.addEventListener(SSE.runEventName, (event: MessageEvent<string>) => {
      const next = Number(event.lastEventId);
      if (!Number.isSafeInteger(next) || next <= cursor) return;
      cursor = next;
      invalidate();
    });
    stream.onerror = invalidate;
    return () => {
      stream.close();
      if (timer) clearTimeout(timer);
    };
  }, [runId, sequence, refresh]);
  const candidate =
    !listError && !stateError && state
      ? decisions.find(
          (d) =>
            d.projectId === selectedId &&
            !dismissed.has(`${d.id}:${d.proposalVersion}`),
        )
      : undefined;
  useEffect(() => {
    if (!candidate || panel !== null || suspendAutoPanels) return;
    const timer = setTimeout(() => {
      setDecisionId(candidate.id);
      setPanel("decision");
    }, 0);
    return () => clearTimeout(timer);
  }, [candidate, panel, suspendAutoPanels]);
  function closePanel() {
    if (panel === "decision" && decisionId) {
      const decision = decisions.find((d) => d.id === decisionId);
      if (decision)
        setDismissed((previous) =>
          new Set(previous).add(`${decision.id}:${decision.proposalVersion}`),
        );
    }
    setPanel(null);
    setDecisionId(null);
  }
  function selectProject(id: string) {
    if (!projects.some((project) => project.id === id)) return;
    setMissingProject(false);
    setSelectedId(id);
    closePanel();
    const url = new URL(window.location.href);
    url.searchParams.set("project", id);
    window.history.replaceState(null, "", url);
  }
  function answered() {
    closePanel();
    setToast("응답이 접수됐어요. 실제 적용 상태를 다시 확인합니다.");
    refresh();
  }
  return {
    pendingCommands,
    projects,
    decisions,
    selectedId,
    selected: projects.find((p) => p.id === selectedId),
    state,
    stateError,
    listError,
    missingProject,
    listLoading,
    connected: connection === "connected",
    connection,
    panel,
    decisionId,
    toast,
    dismissToast: () => setToast(null),
    refresh,
    selectProject,
    openPanel: setPanel,
    closePanel,
    openDecision: (id: string) => {
      setDecisionId(id);
      setPanel("decision");
    },
    answered,
  };
}
