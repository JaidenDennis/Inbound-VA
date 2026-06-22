'use client';

interface BadgeProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'gray';
  size?: 'sm' | 'md';
}

const variantStyles = {
  primary: 'bg-primary-50 text-primary-700 border border-primary-200',
  secondary: 'bg-secondary-50 text-secondary-700 border border-secondary-200',
  success: 'bg-green-50 text-green-700 border border-green-200',
  warning: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  error: 'bg-red-50 text-red-700 border border-red-200',
  gray: 'bg-gray-100 text-gray-700 border border-gray-200',
};

const sizeStyles = {
  sm: 'px-2.5 py-1 text-xs font-medium rounded',
  md: 'px-3 py-1.5 text-sm font-medium rounded-md',
};

export function Badge({ label, variant = 'gray', size = 'sm' }: BadgeProps) {
  return <span className={`inline-block ${variantStyles[variant]} ${sizeStyles[size]}`}>{label}</span>;
}
