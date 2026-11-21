import type { ButtonHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  pending = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`pixel-button pixel-button--${variant} ${className}`}
    >
      {pending ? "처리 중…" : children}
    </button>
  );
}
