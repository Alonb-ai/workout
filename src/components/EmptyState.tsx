import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * "There is nothing here yet" as a deliberate surface: a real card with the
 * icon sunk into a recessed well, so it reads as a designed state rather than
 * as a screen that failed to load.
 */
export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="card-flat flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && (
        <div className="field flex h-14 w-14 items-center justify-center rounded-2xl text-fg-dim [&>svg]:h-6 [&>svg]:w-6">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-base font-bold">{title}</h3>
        {description && (
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
