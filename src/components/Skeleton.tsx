interface SkeletonProps {
  className?: string;
}

export default function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} aria-hidden="true" />;
}
