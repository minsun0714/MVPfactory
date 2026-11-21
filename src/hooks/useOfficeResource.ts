"use client";
import { useEffect, useState } from "react";
import { officeError, officeRequest } from "@/services/office-api";

/** Keyed result prevents the previous project's data from flashing during a switch. */
export function useOfficeResource<T>(path: string | null, refreshKey?: number) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    data?: T;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    officeRequest<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ path, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({ path, error: officeError(error) });
      });
    return () => controller.abort();
  }, [path, revision, refreshKey]);
  const current = result?.path === path ? result : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!path && !current,
    reload: () => {
      setResult(null);
      setRevision((value) => value + 1);
    },
  };
}
