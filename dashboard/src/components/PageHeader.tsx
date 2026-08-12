'use client';

import { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  /** Mono micro-label above the title — the site's `.kicker`. */
  eyebrow?: string;
}

export function PageHeader({ title, description, action, breadcrumbs, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs">
            {breadcrumbs.map((crumb, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {crumb.href ? (
                  <a
                    href={crumb.href}
                    className="text-text-secondary underline decoration-hairline underline-offset-2 transition-colors hover:text-action"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-text-secondary" aria-current="page">{crumb.label}</span>
                )}
                {i < breadcrumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-text-muted" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="label-instrument mb-2">{eyebrow}</p>}
          {/* Scale carries hierarchy here, not shouting: the page title sits one
              clear step above section headings and no further. */}
          <h1 className="font-heading text-2xl font-medium tracking-[-0.02em] text-text">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-text-secondary">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
