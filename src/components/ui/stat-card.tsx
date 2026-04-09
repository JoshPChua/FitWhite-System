import { type ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const variantStyles = {
  default: 'bg-white border-brand-100/50',
  success: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-200/50',
  warning: 'bg-gradient-to-br from-amber-50 to-white border-amber-200/50',
  danger: 'bg-gradient-to-br from-rose-50 to-white border-rose-200/50',
  info: 'bg-gradient-to-br from-blue-50 to-white border-blue-200/50',
};

const iconVariantStyles = {
  default: 'bg-brand-100 text-brand-600',
  success: 'bg-emerald-100 text-emerald-600',
  warning: 'bg-amber-100 text-amber-600',
  danger: 'bg-rose-100 text-rose-600',
  info: 'bg-blue-100 text-blue-600',
};

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  variant = 'default',
  className = '',
}: StatCardProps) {
  return (
    <div
      className={`rounded-2xl border p-5 shadow-card hover:shadow-card-hover transition-shadow duration-300 ${variantStyles[variant]} ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-500 truncate">{title}</p>
          <p className="text-2xl font-bold text-brand-900 mt-1 tracking-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs text-brand-400 mt-1">{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={`text-xs font-semibold ${
                  trend.value >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
              <span className="text-xs text-brand-400">{trend.label}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={`p-2.5 rounded-xl ${iconVariantStyles[variant]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
