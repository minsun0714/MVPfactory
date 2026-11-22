"use client";
import { useId, useRef, useState } from "react";
import type {
  OfficeState,
  Result,
  ExecutionReadiness,
  StartRunRequest,
} from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { INPUT_LIMITS } from "@/contracts/common";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
import { officeCommands } from "@/services/office-commands";

/** Mounted with a project/run key: drafts and late responses cannot cross projects. */
export function useDeliveryRequest(
  state: OfficeState,
  onSubmitted: () => void,
) {
  const result = useOfficeResource<Result>(
    apiPaths.projectResult(state.project.id),
    state.lastSequence,
  );
  const [expanded, setExpanded] = useState(false);
  const readiness = useOfficeResource<ExecutionReadiness>(
    expanded ? apiPaths.executionReadiness : null,
  );
  const command = useOfficeCommand();
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const formId = useId();
  const currentResult =
    result.data?.latestRunId === state.run?.id ? result.data : undefined;
  const canSubmit =
    !!feedback.trim() &&
    feedback.length <= INPUT_LIMITS.feedback &&
    readiness.data?.available === true &&
    !state.project.archived &&
    !submitted &&
    !command.pending;
  function submit() {
    if (!canSubmit || !state.run || state.run.status !== "SUCCEEDED") return;
    const body: StartRunRequest = {
      type: "REVISION",
      mode: "REAL",
      ceoLevel: state.run.ceoLevel,
      feedback: feedback.trim(),
    };
    const fingerprint = JSON.stringify({ projectId: state.project.id, body });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, key: crypto.randomUUID() };
    const key = submission.current.key;
    void command.execute(
      () => officeCommands.start(state.project.id, body, key),
      () => {
        setSubmitted(true);
        onSubmitted();
      },
    );
  }
  return {
    result,
    currentResult,
    readiness,
    command,
    expanded,
    setExpanded,
    feedback,
    setFeedback,
    canSubmit,
    submit,
    submitted,
    formId,
  };
}
