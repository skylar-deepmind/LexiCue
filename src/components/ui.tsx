import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { LoadingSpinner } from './Skeleton';

export function Button({ variant = 'primary', loading = false, className = '', children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet'; loading?: boolean }) {
  return <button className={`ui-button ui-button-${variant} disabled:cursor-not-allowed disabled:opacity-50 ${className}`} disabled={disabled || loading} {...props}>{loading && <LoadingSpinner className="mr-2" />}{children}</button>;
}

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button aria-label={label} title={label} className={`ui-icon-button ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`ui-card ${className}`}>{children}</section>;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div className="ui-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}><div className="ui-progress__value" style={{ width: `${safeValue}%` }} /></div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="ui-page-title">{title}</h1>{description && <p className="mt-1 max-w-2xl text-sm text-gray-500">{description}</p>}</div>{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}</header>;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (value: T) => void; items: { value: T; label: string }[]; label: string }) {
  return <div className="ui-tabs" role="tablist" aria-label={label}>{items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={`ui-tab ${value === item.value ? 'ui-tab-active' : ''}`} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

export function StatCard({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'warm' | 'success' }) {
  return <section className={`ui-card ui-stat-card ui-stat-card-${tone}`}><p>{label}</p><strong>{value}</strong></section>;
}

export function TaskCard({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <section className="ui-task-card"><p className="ui-task-card__eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p><div className="mt-5">{children}</div></section>;
}
