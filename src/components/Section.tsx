import type { ReactNode } from 'react';

interface SectionProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  noPad?: boolean;
}

export function Section({ title, action, description, children, noPad }: SectionProps) {
  return (
    <section className="mb-5">
      {(title || action) && (
        <div className="flex items-center justify-between mb-2 px-1">
          <div>
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="text-2xs text-fg-muted mt-0.5">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? '' : ''}>{children}</div>
    </section>
  );
}
