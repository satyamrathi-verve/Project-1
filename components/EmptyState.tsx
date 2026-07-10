import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/* A friendlier empty state for tables — icon, message, and an optional CTA. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface2 text-faint">
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
