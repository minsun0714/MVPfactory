"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PixelIcon } from "@/components/ui/PixelIcon";

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  dirty = false,
  closeDisabled = false,
}: {
  open: boolean;
  dirty?: boolean;
  closeDisabled?: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keepEditing.current?.focus();
  }, [confirming]);
  function requestClose() {
    if (closeDisabled) return;
    if (dirty) setConfirming(true);
    else onClose();
  }
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="pixel-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const stops = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]",
          ),
        ).filter(
          (node) => node.tabIndex >= 0 && node.getClientRects().length > 0,
        );
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className="pixel-dialog-heading">
        <div>
          <span className="pixel-eyebrow">MVP FACTORY</span>
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descriptionId} className="pixel-muted">
              {description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          aria-label="창 닫기"
          onClick={requestClose}
          disabled={closeDisabled}
          autoFocus
        >
          <PixelIcon name="close" />
        </Button>
      </div>
      <div className="pixel-dialog-content">
        {confirming && (
          <div className="pixel-stack" role="alert">
            <h3>저장하지 않은 변경이 있어요</h3>
            <p>닫으면 작성 중인 변경사항이 사라져요.</p>
            <div className="pixel-wrap">
              <button
                ref={keepEditing}
                type="button"
                className="pixel-button pixel-button--primary"
                onClick={() => setConfirming(false)}
              >
                계속 편집
              </button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  onClose();
                }}
              >
                변경 버리고 닫기
              </Button>
            </div>
          </div>
        )}
        <div hidden={confirming}>{children}</div>
      </div>
    </dialog>
  );
}
