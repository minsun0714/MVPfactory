"use client";
import { useEffect, useRef, useState } from "react";
import type { Decision, DecisionChoice, Project } from "@/contracts";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { apiPaths } from "@/contracts/paths";
import { officeApi, officeError, OfficeApiError } from "@/services/office-api";

export function useDecisionReview(id: string | null, onAnswered: () => void) {
  const [loaded, setLoaded] = useState<{
    id: string;
    decision?: Decision;
    error?: string;
  } | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { comment: string; optionId: string }>
  >({});
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{
    id: string;
    message: string;
    conflict: boolean;
  } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    officeApi
      .decision(id, controller.signal)
      .then((decision) => {
        if (!controller.signal.aborted) setLoaded({ id, decision });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ id, error: officeError(error) });
      });
    return () => controller.abort();
  }, [id, revision]);
  const current = loaded?.id === id ? loaded : null;
  const project = useOfficeResource<Project>(
    current?.decision ? apiPaths.project(current.decision.projectId) : null,
  );
  const draft = id
    ? (drafts[id] ?? { comment: "", optionId: "" })
    : { comment: "", optionId: "" };
  function changeDraft(field: "comment" | "optionId", value: string) {
    if (!id || lock.current) return;
    setDrafts((all) => ({ ...all, [id]: { ...draft, [field]: value } }));
  }
  async function submit(choice: DecisionChoice) {
    const decision = current?.decision;
    if (
      !id ||
      !decision ||
      !project.data ||
      lock.current ||
      decision.status !== "OPEN"
    )
      return;
    if (choice === "REQUEST_CHANGES" && !draft.comment.trim()) {
      setFailure({
        id,
        message: "수정할 내용을 입력해주세요.",
        conflict: false,
      });
      return;
    }
    if (
      choice === "SELECT_OPTION" &&
      !decision.options.some((option) => option.id === draft.optionId)
    ) {
      setFailure({ id, message: "선택지를 골라주세요.", conflict: false });
      return;
    }
    lock.current = true;
    setPending(true);
    setFailure(null);
    try {
      await officeApi.respond(id, {
        proposalVersion: decision.proposalVersion,
        choice,
        ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {}),
        ...(choice === "SELECT_OPTION" ? { optionId: draft.optionId } : {}),
      });
      onAnswered();
    } catch (error) {
      setFailure({
        id,
        message: officeError(error),
        conflict: error instanceof OfficeApiError && error.status === 409,
      });
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return {
    decision: current?.decision,
    project,
    loading: !!id && !current,
    error: current?.error,
    draft,
    changeDraft,
    pending,
    failure: failure?.id === id ? failure : null,
    submit,
    reload: () => {
      setLoaded(null);
      setFailure(null);
      setRevision((v) => v + 1);
    },
  };
}
