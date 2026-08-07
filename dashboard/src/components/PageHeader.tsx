'use client';

import { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export function PageHeader({ title, description, action, breadcrumbs }: PageHeaderProps) {
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
                    className="text-panel-600 underline decoration-panel-300 underline-offset-2 transition-colors hover:text-ink-800 hover:decoration-panel-500"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-panel-500" aria-current="page">{crumb.label}</span>
                )}
                {i < breadcrumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-panel-400" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {/* Scale carries hierarchy here, not shouting: the page title sits one
              clear step above section headings and no further. */}
          <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em] text-ink-900">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-panel-600">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
