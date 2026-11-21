"use client";
import { useEffect, useRef, useState } from "react";
import { officeError } from "@/services/office-api";
/** Serializes user commands and ignores UI updates after unmount. */
export function useOfficeCommand() {
  const lock = useRef(false);
  const alive = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function execute<T>(
    work: () => Promise<T>,
    success?: (data: T) => void,
  ) {
    if (lock.current) return;
    lock.current = true;
    window.dispatchEvent(new CustomEvent("office-command", { detail: 1 }));
    setPending(true);
    setError("");
    try {
      const result = await work();
      if (alive.current) {
        success?.(result);
        window.dispatchEvent(
          new CustomEvent("factory-toast", { detail: "요청을 반영했습니다." }),
        );
      }
      return result;
    } catch (cause) {
      if (alive.current) setError(officeError(cause));
    } finally {
      lock.current = false;
      window.dispatchEvent(new CustomEvent("office-command", { detail: -1 }));
      if (alive.current) setPending(false);
    }
  }
  return { pending, error, execute };
}
