"use client";
import { useEffect, useRef, useState } from "react";
import type { Meeting, OfficeState, RoleId } from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { projectScene } from "@/components/office/scene/model";
import type { OfficeScene } from "@/components/office/scene/renderer";

export function useOfficeScene(
  state: OfficeState | undefined,
  onRole: (role: RoleId) => void,
  onMeeting: () => void,
  disabled: boolean,
) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<OfficeScene | null>(null);
  const callbacks = useRef({ onRole, onMeeting, disabled });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [still, setStill] = useState(false);
  const meeting = useOfficeResource<Meeting>(
    state?.activeMeeting ? apiPaths.meeting(state.activeMeeting.id) : null,
    state?.lastSequence,
  );
  const snapshot = projectScene(state, meeting.data);
  const latest = useRef({ snapshot, reduced: false });
  useEffect(() => {
    callbacks.current = { onRole, onMeeting, disabled };
  }, [onRole, onMeeting, disabled]);
  useEffect(() => {
    latest.current = { snapshot, reduced: reduced || still };
    renderer.current?.update(snapshot, reduced || still);
  }, [snapshot, reduced, still]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    const timer = setTimeout(update, 0);
    media.addEventListener("change", update);
    return () => {
      clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const lost = (event: Event) => {
      event.preventDefault();
      setReady(false);
      setError("그래픽 연결이 끊겼습니다.");
    };
    container.addEventListener("webglcontextlost", lost, true);
    const controller = new AbortController();
    let scene: OfficeScene | undefined;
    void import("@/components/office/scene/renderer")
      .then((module) =>
        module.createOfficeScene(
          container,
          controller.signal,
          (role) => {
            if (!callbacks.current.disabled) callbacks.current.onRole(role);
          },
          () => {
            if (!callbacks.current.disabled) callbacks.current.onMeeting();
          },
        ),
      )
      .then((created) => {
        if (controller.signal.aborted) {
          created.destroy();
          return;
        }
        scene = created;
        renderer.current = created;
        created.update(latest.current.snapshot, latest.current.reduced);
        setReady(true);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "사무실 렌더러를 시작하지 못했습니다.",
          );
          setReady(false);
        }
      });
    return () => {
      container.removeEventListener("webglcontextlost", lost, true);
      controller.abort();
      scene?.destroy();
      if (renderer.current === scene) renderer.current = null;
    };
  }, [attempt]);
  return {
    host,
    ready,
    error,
    statement: meeting.data?.statements.reduce<
      Meeting["statements"][number] | undefined
    >(
      (last, next) => (!last || next.sequence > last.sequence ? next : last),
      undefined,
    ),
    meeting: meeting.data,
    meetingError: meeting.error,
    reduced: reduced || still,
    still,
    toggleMotion: () => setStill((v) => !v),
    skip: () => renderer.current?.skip(),
    retry: () => {
      setError("");
      setReady(false);
      setAttempt((v) => v + 1);
    },
  };
}
