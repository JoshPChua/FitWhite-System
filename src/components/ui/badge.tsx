interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
  size?: 'sm' | 'md';
  className?: string;
}

const variants = {
  default: 'bg-stone-100 text-stone-700',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200/50',
  warning: 'bg-amber-50 text-amber-700 border border-amber-200/50',
  danger: 'bg-rose-50 text-rose-700 border border-rose-200/50',
  info: 'bg-blue-50 text-blue-700 border border-blue-200/50',
  brand: 'bg-brand-100 text-brand-700 border border-brand-200/50',
};

const sizes = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

export function Badge({ children, variant = 'default', size = 'md', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full whitespace-nowrap ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}
