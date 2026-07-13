import type { ReactNode } from "react";

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "muted" }) {
  return <span className={variant === "muted" ? "badge badge-muted" : "badge"}>{children}</span>;
}
