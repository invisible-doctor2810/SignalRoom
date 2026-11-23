/**
 * Input validators for server actions. Every value arriving in `params` is
 * `unknown` and is validated here before it reaches a write.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** Required, trimmed, non-empty string with a length cap. */
export function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${name} is required`)
  const normalized = value.trim()
  if (!normalized) throw new ValidationError(`${name} is required`)
  if (normalized.length > maxLength) throw new ValidationError(`${name} is too long`)
  return normalized
}

/** Optional string; missing/empty becomes ''. */
export function optionalText(value: unknown, name: string, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ValidationError(`${name} must be text`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new ValidationError(`${name} is too long`)
  return normalized
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid ${name}`)
  }
  return value as T
}

/** A record id supplied by the client. Ids are opaque, but bounded and printable. */
export function recordId(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${name} is required`)
  const id = value.trim()
  if (!id || id.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(id)) {
    throw new ValidationError(`Invalid ${name}`)
  }
  return id
}

/** Optional record id; missing/empty becomes ''. */
export function optionalRecordId(value: unknown, name: string): string {
  if (value === undefined || value === null || value === '') return ''
  return recordId(value, name)
}

/** ISO-8601 (or any Date-parsable) timestamp, normalized to ISO. */
export function timestamp(value: unknown, name: string): string {
  const raw = requiredText(value, name, 40)
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) throw new ValidationError(`Invalid ${name}`)
  return new Date(parsed).toISOString()
}

export function booleanFlag(value: unknown, name: string): boolean {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw new ValidationError(`Invalid ${name}`)
  return value
}

export function email(value: unknown, name = 'Email'): string {
  const raw = requiredText(value, name, 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new ValidationError(`Invalid ${name}`)
  return raw
}

/**
 * Picks only the keys present in `params` for a partial update, so an update
 * action never overwrites a field the caller did not send.
 */
export function has(params: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined
}
