"use client";
import { useEffect, useState } from "react";
export function useToastNotifications() {
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string")
        return;
      clearTimeout(timer);
      setToast({ text: event.detail, id: Date.now() });
      timer = setTimeout(() => setToast(null), 4000);
    };
    window.addEventListener("factory-toast", receive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("factory-toast", receive);
    };
  }, []);
  return { toast, dismiss: () => setToast(null) };
}
