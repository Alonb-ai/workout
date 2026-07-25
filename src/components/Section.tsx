import type { ReactNode } from 'react';

interface SectionProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
}

/**
 * A titled block. The header is a quiet eyebrow with an optional action on the
 * opposite edge — it labels the content below rather than competing with it.
 */
export function Section({ title, action, description, children }: SectionProps) {
  return (
    <section className="mb-6">
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title && <h2 className="eyebrow">{title}</h2>}
            {description && <p className="mt-1 text-2xs text-fg-dim">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
