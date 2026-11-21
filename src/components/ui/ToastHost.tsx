"use client";
import { useEffect, useRef } from "react";
import { useToastNotifications } from "@/hooks/useToastNotifications";
export function ToastHost() {
  const { toast, dismiss } = useToastNotifications();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (toast) host.current?.showPopover();
    else host.current?.hidePopover();
  }, [toast]);
  return (
    <div
      ref={host}
      popover="manual"
      className="factory-ui factory-command-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toast && (
        <>
          <span>{toast.text}</span>
          <button type="button" onClick={dismiss} aria-label="알림 닫기">
            닫기
          </button>
        </>
      )}
    </div>
  );
}
