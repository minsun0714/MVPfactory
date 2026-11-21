"use client";
import { useEffect, useState } from "react";
import { officeError, officeList } from "@/services/office-api";
export function useOfficeList<T>(path: string, refreshKey?: number) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    data?: { items: T[] };
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    officeList<T>(path, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setResult({ path, data: { items } });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ path, error: officeError(error) });
      });
    return () => controller.abort();
  }, [path, refreshKey, revision]);
  const current = result?.path === path ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    reload: () => {
      setResult(undefined);
      setRevision((v) => v + 1);
    },
  };
}
