import type { ReactNode } from "react";
import NeoIcon from "./NeoIcon";

export function HoloPanel({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return <section className={`ng-panel ${className}`} aria-label={title}>{children}</section>;
}
export function HUDSectionTitle({ code, title, description, action }: { code: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="ng-section-head"><div><span className="ng-kicker">{code}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function NeoEmptyState({ title, children, error = false }: { title: string; children?: ReactNode; error?: boolean }) {
  return <div className={`ng-empty${error ? " is-error" : ""}`} role={error ? "alert" : "status"}><NeoIcon name={error ? "bolt" : "layers"} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function NeoSkeleton({ rows = 3 }: { rows?: number }) { return <div className="ng-skeleton" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div>; }
