/**
 * Server-side incident authorization.
 *
 * Action tools run with per-record RBAC OFF (see action-routes.ts), so every
 * incident action must call `requireIncidentAccess` before reading or writing
 * anything, and must load referenced child records through
 * `loadIncidentRecord` so an id from another incident is rejected.
 *
 * `userId` is always the verified caller identity from the action context —
 * never a value from `params`.
 */

import type { ActionTools } from 'deepspace/worker'
import {
  INCIDENT_CLOSED_MESSAGE,
  canPerform,
  isBlockedWhenClosed,
  type IncidentOperation,
} from '../domain/authorization'
import {
  membershipRecordId,
  type IncidentData,
  type IncidentRole,
  type TeamMemberData,
} from '../domain/incident-model'

/** One message for "missing" and "not a member" so ids cannot be probed. */
export const INCIDENT_NOT_FOUND = 'Incident not found or access denied'
export const PERMISSION_DENIED = 'Your incident role does not allow this action'

export class AccessError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'forbidden' | 'incident_closed') {
    super(message)
    this.name = 'AccessError'
  }
}

export interface IncidentAccess {
  incidentId: string
  incident: IncidentData
  role: IncidentRole
  membershipId: string
}

/**
 * Verifies that `userId` is an active member of `incidentId` whose role
 * permits `operation`. Throws `AccessError` otherwise.
 */
export async function requireIncidentAccess(
  tools: ActionTools,
  userId: string,
  incidentId: string,
  operation: IncidentOperation,
): Promise<IncidentAccess> {
  const incidentResult = await tools.get<Record<string, unknown>>('incidents', incidentId)
  if (!incidentResult.success) throw new AccessError(INCIDENT_NOT_FOUND, 'not_found')
  const incident = incidentResult.data.record.data as unknown as IncidentData
  // The record id and the stored incidentId must agree, and an incident still
  // in the internal `Creating` state is not usable (fail closed).
  if (incident.incidentId !== incidentId || incident.status === 'Creating') {
    throw new AccessError(INCIDENT_NOT_FOUND, 'not_found')
  }

  const membershipId = membershipRecordId(incidentId, userId)
  const membershipResult = await tools.get<Record<string, unknown>>('team_members', membershipId)
  if (!membershipResult.success) throw new AccessError(INCIDENT_NOT_FOUND, 'not_found')
  const membership = membershipResult.data.record.data as unknown as TeamMemberData
  if (
    membership.teamId !== incidentId ||
    membership.userId !== userId ||
    membership.status !== 'active'
  ) {
    throw new AccessError(INCIDENT_NOT_FOUND, 'not_found')
  }

  if (!canPerform(membership.role, operation)) {
    throw new AccessError(PERMISSION_DENIED, 'forbidden')
  }
  // Closed incidents are read-only for everyone (reopening is handled by
  // updateIncident, which is not in the blocked set).
  if (incident.status === 'Closed' && isBlockedWhenClosed(operation)) {
    throw new AccessError(INCIDENT_CLOSED_MESSAGE, 'incident_closed')
  }

  return { incidentId, incident, role: membership.role, membershipId }
}

/**
 * Loads a record of an incident-scoped collection and verifies that it
 * belongs to `incidentId`. A record from another incident is reported as
 * not found, exactly like a missing one.
 */
export async function loadIncidentRecord<T extends { incidentId: string }>(
  tools: ActionTools,
  collection: string,
  recordId: string,
  incidentId: string,
  label: string,
): Promise<{ recordId: string; data: T; createdBy: string }> {
  const result = await tools.get<Record<string, unknown>>(collection, recordId)
  if (!result.success) throw new AccessError(`${label} not found`, 'not_found')
  const data = result.data.record.data as unknown as T
  if (data.incidentId !== incidentId) throw new AccessError(`${label} not found`, 'not_found')
  return { recordId, data, createdBy: result.data.record.createdBy }
}
