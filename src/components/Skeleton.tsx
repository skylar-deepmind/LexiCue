import type { ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
}

export default function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton rounded ${className}`} aria-hidden="true" />;
}

export function LoadingSpinner({ className = '' }: SkeletonProps) {
  return <span className={`loading-spinner ${className}`} aria-hidden="true" />;
}

export function LoadingRegion({ label, className = '', children }: SkeletonProps & { label: string; children: ReactNode }) {
  return <div className={className} role="status" aria-live="polite" aria-busy="true" aria-label={label}>{children}</div>;
}
