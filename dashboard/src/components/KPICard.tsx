'use client';

import { ReactNode } from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: 'primary' | 'secondary' | 'accent' | 'success' | 'error';
  trend?: number;
  trendLabel?: string;
  subtitle?: string;
}

const colorStyles = {
  primary: {
    bg: 'bg-primary-50',
    icon: 'text-primary-600',
    accent: 'bg-primary-100',
  },
  secondary: {
    bg: 'bg-secondary-50',
    icon: 'text-secondary-600',
    accent: 'bg-secondary-100',
  },
  accent: {
    bg: 'bg-accent-50',
    icon: 'text-accent-600',
    accent: 'bg-accent-100',
  },
  success: {
    bg: 'bg-green-50',
    icon: 'text-green-600',
    accent: 'bg-green-100',
  },
  error: {
    bg: 'bg-red-50',
    icon: 'text-red-600',
    accent: 'bg-red-100',
  },
};

export function KPICard({ label, value, icon: Icon, color, trend, trendLabel, subtitle }: KPICardProps) {
  const styles = colorStyles[color];
  const isTrendPositive = trend && trend >= 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-lg ${styles.accent}`}>
          <Icon className={`w-6 h-6 ${styles.icon}`} />
        </div>
        {trend !== undefined && (
          <div
            className={`flex items-center gap-1 text-sm font-semibold px-2 py-1 rounded-full ${
              isTrendPositive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {isTrendPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-2">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>

      <div className="flex items-center justify-between">
        {trendLabel && <p className="text-xs text-gray-500">{trendLabel}</p>}
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}
