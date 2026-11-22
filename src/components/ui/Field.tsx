"use client";
import { useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

type LabelProps = { label: string; hint?: string; error?: string };
export function Field({
  label,
  hint,
  error,
  id,
  suffix,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & LabelProps & { suffix?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="pixel-field">
      <label htmlFor={fieldId}>{label}</label>
      <div className={suffix ? "pixel-input-with-unit" : undefined}>
        <input
          {...props}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={
            [
              hint || error ? `${fieldId}-message` : null,
              suffix ? `${fieldId}-unit` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {suffix && (
          <span id={`${fieldId}-unit`} className="pixel-input-unit">
            {suffix}
          </span>
        )}
      </div>
      {(hint || error) && (
        <p
          id={`${fieldId}-message`}
          className={error ? "pixel-error-text" : "pixel-muted"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
export function TextArea({
  label,
  hint,
  error,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & LabelProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="pixel-field">
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        {...props}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${fieldId}-message` : undefined}
      />
      {(hint || error) && (
        <p
          id={`${fieldId}-message`}
          className={error ? "pixel-error-text" : "pixel-muted"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
export { Select } from "@/components/ui/Select";
