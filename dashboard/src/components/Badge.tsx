'use client';

import clsx from 'clsx';

/**
 * A non-status label: plan tier, industry, channel, role.
 *
 * Deliberately achromatic by default. On this surface the three lamp hues mean
 * good, fair, and bad; a badge that borrowed them would make a category look
 * like a health reading. The success/warning/error variants are kept for the
 * routes that already pass them, and they map onto the lamp inks so at least
 * they agree with the rest of the system.
 */

interface BadgeProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'gray';
  size?: 'sm' | 'md';
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  primary: 'bg-action text-[rgb(var(--action-contrast-rgb))] border-action',
  secondary: 'bg-signal-50 text-signal-800 border-signal-200',
  success: 'bg-lamp-good-wash text-lamp-good-ink border-lamp-good-rim',
  warning: 'bg-lamp-fair-wash text-lamp-fair-ink border-lamp-fair-rim',
  error: 'bg-lamp-bad-wash text-lamp-bad-ink border-lamp-bad-rim',
  gray: 'bg-panel-100 text-panel-700 border-panel-200',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-2xs',
  md: 'px-2.5 py-1 text-2xs',
};

export function Badge({ label, variant = 'gray', size = 'sm' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center whitespace-nowrap border font-mono uppercase tracking-[0.14em]',
        variantStyles[variant],
        sizeStyles[size]
      )}
    >
      {label}
    </span>
  );
}
