import { getAuthToken } from 'deepspace'

export class ActionError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
    this.name = 'ActionError'
  }
}

/**
 * Calls a server action at `/api/actions/:name` with the caller's bearer
 * token. Resolves with `data` on success; throws `ActionError` with the
 * server's safe message on a denial or failure.
 */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new ActionError('You are signed out. Sign in and try again.', 'unauthorized')
  const response = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  let payload: { success?: boolean; data?: T; error?: string; code?: string } = {}
  try {
    payload = await response.json()
  } catch {
    // Non-JSON body: fall through to the generic error below.
  }
  if (!response.ok || !payload.success) {
    throw new ActionError(payload.error || `Request failed (${response.status})`, payload.code)
  }
  return payload.data as T
}
