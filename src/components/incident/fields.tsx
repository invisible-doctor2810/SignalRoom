import type { ReactNode } from 'react'
import {
  Badge,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type BadgeProps,
} from '@/components/ui'

/** Labeled text input; the visible label is the accessible name. */
export function TextField({
  label,
  value,
  onChange,
  maxLength,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  type?: 'text' | 'email' | 'datetime-local'
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
      />
    </label>
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} />
    </label>
  )
}

/** Labeled select. `options` are [value, label] pairs; values must be non-empty. */
export function ChoiceField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <div className="space-y-1">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function pairs(values: readonly string[]): Array<readonly [string, string]> {
  return values.map((value) => [value, value] as const)
}

/** `datetime-local` value (local time, minute precision) for an ISO timestamp. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function fromLocalInput(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  Verified: 'success',
  Disputed: 'destructive',
  Unverified: 'secondary',
  Supported: 'success',
  Rejected: 'destructive',
  'Under Investigation': 'info',
  Inconclusive: 'warning',
  Proposed: 'secondary',
  Supports: 'success',
  Contradicts: 'destructive',
  Neutral: 'secondary',
  Critical: 'destructive',
  High: 'warning',
}

export function StatusBadge({ value }: { value: string }) {
  return <Badge variant={STATUS_VARIANTS[value] ?? 'secondary'}>{value}</Badge>
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export function ReadOnlyNotice({ closed = false }: { closed?: boolean }) {
  return (
    <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
      {closed
        ? 'This incident is closed. Investigation records are read-only until the Owner reopens it.'
        : 'You have Viewer access to this incident. Investigation records are read-only.'}
    </p>
  )
}
