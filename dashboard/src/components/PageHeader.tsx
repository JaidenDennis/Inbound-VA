'use client';

import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export function PageHeader({ title, description, action, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <div key={i} className="flex items-center gap-2">
              {crumb.href ? (
                <a href={crumb.href} className="text-primary-600 hover:text-primary-700 transition-colors">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-gray-600">{crumb.label}</span>
              )}
              {i < breadcrumbs.length - 1 && <span className="text-gray-300">/</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{title}</h1>
          {description && <p className="text-gray-600 text-lg">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
