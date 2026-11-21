import type { ReactNode } from "react";
import { PixelIcon } from "@/components/ui/PixelIcon";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span className={`pixel-badge pixel-badge--${tone}`}>
      <span aria-hidden="true">
        {tone === "success" ? "✓" : tone === "danger" ? "!" : "▪"}
      </span>
      {children}
    </span>
  );
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`pixel-card ${className}`}>{children}</div>;
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="pixel-empty">
      <PixelIcon name="projects" width="32" height="32" />
      <h3>{title}</h3>
      <p className="pixel-muted">{children}</p>
    </div>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(
    100,
    Math.max(0, Number.isFinite(value) ? value : 0),
  );
  return (
    <div className="pixel-progress">
      <div className="pixel-row">
        <span>{label}</span>
        <span>{safeValue}%</span>
      </div>
      <progress max={100} value={safeValue} aria-label={label} />
    </div>
  );
}
