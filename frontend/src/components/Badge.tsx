import type { ReactNode } from "react";

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "muted" | "danger" }) {
  const className = variant === "muted" ? "badge badge-muted" : variant === "danger" ? "badge badge-danger" : "badge";
  return <span className={className}>{children}</span>;
}
