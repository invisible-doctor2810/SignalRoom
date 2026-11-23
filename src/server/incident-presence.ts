/**
 * Incident-scoped presence (ARCHITECTURE_PROPOSAL §7 "Ephemeral Presence").
 *
 * Each incident has its own PresenceRoom instance, addressed by the canonical
 * scope `incident:<incidentId>`. The Worker admits a socket only after
 * verifying the JWT and the caller's active membership; the room itself never
 * grants access. When a member is removed, `evictFromIncidentPresence` closes
 * their live sockets so they stop appearing (and stop seeing peers) at once.
 */

import type { ActionTools } from 'deepspace/worker'
import { INCIDENT_PRESENCE_PREFIX, incidentPresenceScope } from '../domain/incident-model'
import { recordId } from '../domain/validation'
import { requireIncidentAccess } from './incident-access'

export { incidentPresenceScope }
export const EVICT_USER_PATH = '/internal/evict-user'
/** WebSocket close code sent to a member whose access was revoked. */
export const MEMBERSHIP_REVOKED_CLOSE_CODE = 4403

/** Returns the incident id of a well-formed `incident:<id>` scope, else null. */
export function parseIncidentPresenceScope(scope: string | undefined): string | null {
  if (!scope || !scope.startsWith(INCIDENT_PRESENCE_PREFIX)) return null
  try {
    return recordId(scope.slice(INCIDENT_PRESENCE_PREFIX.length), 'Incident')
  } catch {
    return null
  }
}

export type PresenceDecision =
  | { allowed: true; incidentId: string; scope: string }
  | { allowed: false; status: 401 | 403 | 404 }

/**
 * Decides whether a verified caller may join a presence scope. Only incident
 * scopes exist; any other scope is refused (fail closed).
 */
export async function authorizeIncidentPresence(
  tools: ActionTools,
  userId: string | null,
  scope: string | undefined,
): Promise<PresenceDecision> {
  const incidentId = parseIncidentPresenceScope(scope)
  if (!incidentId) return { allowed: false, status: 404 }
  if (!userId) return { allowed: false, status: 401 }
  try {
    await requireIncidentAccess(tools, userId, incidentId, 'presence.join')
  } catch {
    // Same answer for "no such incident" and "not a member".
    return { allowed: false, status: 403 }
  }
  return { allowed: true, incidentId, scope: incidentPresenceScope(incidentId) }
}

/** Minimal binding surface needed to reach a presence room. */
export interface PresenceNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> }
}

/**
 * Closes every presence socket `userId` holds in the incident's room.
 * Best effort: membership removal has already succeeded and is what revokes
 * access; a failure here is logged, not surfaced as a failed removal.
 */
export async function evictFromIncidentPresence(
  namespace: PresenceNamespace | undefined,
  incidentId: string,
  userId: string,
): Promise<number> {
  if (!namespace) return 0
  try {
    const stub = namespace.get(namespace.idFromName(incidentPresenceScope(incidentId)))
    const response = await stub.fetch(
      new Request(`https://internal${EVICT_USER_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }),
    )
    const body = (await response.json()) as { closed?: number }
    return body.closed ?? 0
  } catch (error) {
    console.error('[presence] eviction failed', error)
    return 0
  }
}
