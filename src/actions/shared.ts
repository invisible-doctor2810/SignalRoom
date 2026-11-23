import type { ActionContext, ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { ValidationError } from '../domain/validation'
import { AccessError } from '../server/incident-access'

export type Params = Record<string, unknown>

/**
 * Wraps an action so validation and authorization failures become structured
 * denials (`{ success: false, error, code }`) instead of thrown errors.
 * Unexpected errors are logged server-side and reported generically.
 */
export function action(
  name: string,
  handler: (ctx: ActionContext<Env>) => Promise<ActionResult>,
): ActionHandler<Env> {
  return async (ctx) => {
    try {
      return await handler(ctx)
    } catch (error) {
      if (error instanceof ValidationError) {
        return { success: false, error: error.message, code: 'invalid_input' }
      }
      if (error instanceof AccessError) {
        return { success: false, error: error.message, code: error.code }
      }
      console.error(`[action] ${name} failed`, error)
      return { success: false, error: 'The request could not be completed', code: 'internal_error' }
    }
  }
}

/** Turns a failed tool write into a thrown error with a safe message. */
export function ensureWrite<T>(result: ActionResult<T>, message: string): T {
  if (!result.success) {
    console.error(`[action] write failed: ${message}: ${result.error}`)
    throw new Error(message)
  }
  return result.data
}

/**
 * Deletes every record matching `where` (which must include `incidentId`, so
 * cleanup can never reach another incident), draining in bounded batches.
 */
export async function deleteAllWhere(
  tools: ActionTools,
  collection: string,
  where: Record<string, unknown> & { incidentId: string },
): Promise<number> {
  const limit = 100
  let total = 0
  for (let round = 0; round < 50; round += 1) {
    const result = ensureWrite(
      await tools.deleteWhere(collection, where, limit),
      `Failed to clean up ${collection}`,
    )
    total += result.deleted
    if (result.deleted < limit) return total
  }
  throw new Error(`Too many ${collection} records to clean up`)
}

export function requireNonEmptyPatch(patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to update')
}
