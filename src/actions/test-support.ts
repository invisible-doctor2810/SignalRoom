/**
 * In-memory stand-in for the action `tools` (RBAC-off record access), used by
 * unit tests to exercise the real action handlers and authorization helpers.
 * Mirrors the SDK `ActionTools` result envelopes for the methods actions use.
 */

import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { actions } from './index'

interface StoredRow {
  data: Record<string, unknown>
  createdBy: string
  createdAt: string
  updatedAt: string
}

export class FakeDb {
  readonly collections = new Map<string, Map<string, StoredRow>>()
  private counter = 0

  table(name: string): Map<string, StoredRow> {
    let table = this.collections.get(name)
    if (!table) {
      table = new Map()
      this.collections.set(name, table)
    }
    return table
  }

  nextId(): string {
    this.counter += 1
    return `rec${this.counter}`
  }

  seed(collection: string, recordId: string, data: Record<string, unknown>, createdBy = 'system'): void {
    const now = new Date().toISOString()
    this.table(collection).set(recordId, { data: { ...data }, createdBy, createdAt: now, updatedAt: now })
  }

  rows(collection: string): Array<{ recordId: string } & StoredRow> {
    return [...this.table(collection).entries()].map(([recordId, row]) => ({ recordId, ...row }))
  }
}

const notFound = { success: false as const, error: 'Record not found', code: 'not_found' }

export function fakeTools(db: FakeDb, actingUserId: string): ActionTools {
  const record = (recordId: string, row: StoredRow) => ({
    recordId,
    data: row.data,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

  const tools: Partial<ActionTools> = {
    async create(collection, data, recordId) {
      const id = recordId ?? db.nextId()
      const table = db.table(collection)
      if (table.has(id)) return { success: false, error: 'Record already exists' }
      const now = new Date().toISOString()
      table.set(id, { data: { ...data }, createdBy: actingUserId, createdAt: now, updatedAt: now })
      return { success: true, data: { recordId: id } }
    },
    async update(collection, recordId, data) {
      const row = db.table(collection).get(recordId)
      if (!row) return notFound
      row.data = { ...row.data, ...data }
      row.updatedAt = new Date().toISOString()
      return { success: true, data: { recordId } }
    },
    async remove(collection, recordId) {
      if (!db.table(collection).delete(recordId)) return notFound
      return { success: true, data: { recordId } }
    },
    async deleteWhere(collection, where, limit = 100) {
      if (Object.keys(where).length === 0) return { success: false, error: 'where must be non-empty' }
      const table = db.table(collection)
      const matches = [...table.entries()]
        .filter(([, row]) => Object.entries(where).every(([key, value]) => row.data[key] === value))
        .slice(0, limit)
      for (const [id] of matches) table.delete(id)
      return { success: true, data: { deleted: matches.length } }
    },
    async get(collection, recordId) {
      const row = db.table(collection).get(recordId)
      if (!row) return notFound
      return { success: true, data: { record: record(recordId, row) } } as ActionResult<never>
    },
    async query(collection, options) {
      const where = options?.where ?? {}
      const matches = [...db.table(collection).entries()]
        .filter(([, row]) => Object.entries(where).every(([key, value]) => row.data[key] === value))
        .slice(0, options?.limit ?? 100)
        .map(([recordId, row]) => record(recordId, row))
      return { success: true, data: { records: matches, count: matches.length } } as ActionResult<never>
    },
  }
  return tools as ActionTools
}

/** Records presence-room requests in place of the PRESENCE_ROOMS binding. */
export class FakePresenceNamespace {
  readonly requests: Array<{ room: string; path: string; body: unknown }> = []

  idFromName(name: string): DurableObjectId {
    return { name, toString: () => name, equals: () => false } as unknown as DurableObjectId
  }

  get(id: DurableObjectId) {
    const room = (id as unknown as { name: string }).name
    return {
      fetch: async (request: Request) => {
        this.requests.push({ room, path: new URL(request.url).pathname, body: await request.json() })
        return Response.json({ success: true, closed: 1 })
      },
    }
  }
}

/** Invokes a registered action exactly as the HTTP route would. */
export async function callAs(
  db: FakeDb,
  userId: string,
  name: string,
  params: Record<string, unknown>,
  env: Partial<Env> = {},
): Promise<ActionResult> {
  const handler = actions[name]
  if (!handler) throw new Error(`Unknown action ${name}`)
  return handler({ userId, params, tools: fakeTools(db, userId), env: env as Env, callerJwt: 'test' })
}
