/**
 * SignalRoom incident operation policy (docs/ARCHITECTURE_PROPOSAL.md §4).
 *
 * This table is enforced server-side by every action through
 * `requireIncidentAccess`; the UI reads the same table only to decide which
 * controls to show. UI visibility is never the authorization.
 */

import type { IncidentRole, IncidentStatus } from './incident-model'

export type IncidentOperation =
  | 'incident.read'
  | 'incident.update'
  | 'members.read'
  | 'members.manage'
  | 'evidence.write'
  | 'timeline.write'
  | 'hypothesis.write'
  | 'evidenceLink.write'
  | 'presence.join'

const POLICY: Record<IncidentOperation, readonly IncidentRole[]> = {
  'incident.read': ['Owner', 'Investigator', 'Viewer'],
  'presence.join': ['Owner', 'Investigator', 'Viewer'],
  'members.read': ['Owner', 'Investigator', 'Viewer'],
  'incident.update': ['Owner'],
  'members.manage': ['Owner'],
  'evidence.write': ['Owner', 'Investigator'],
  'timeline.write': ['Owner', 'Investigator'],
  'hypothesis.write': ['Owner', 'Investigator'],
  'evidenceLink.write': ['Owner', 'Investigator'],
}

export function canPerform(role: IncidentRole | null | undefined, operation: IncidentOperation): boolean {
  if (!role) return false
  return POLICY[operation].includes(role)
}

/**
 * Closed incidents are read-only for every member, Owner included. The only
 * change accepted on a closed incident is the Owner reopening it (enforced in
 * `updateIncident`, which allows a status-only patch to a non-Closed status).
 *
 * Membership management is deliberately NOT blocked: revoking someone's
 * access must remain possible on a closed incident.
 */
const BLOCKED_WHEN_CLOSED: ReadonlySet<IncidentOperation> = new Set([
  'evidence.write',
  'timeline.write',
  'hypothesis.write',
  'evidenceLink.write',
])

export function isBlockedWhenClosed(operation: IncidentOperation): boolean {
  return BLOCKED_WHEN_CLOSED.has(operation)
}

export const INCIDENT_CLOSED_MESSAGE = 'This incident is closed and read-only. The Owner can reopen it.'

/** Whether `role` may perform `operation` on an incident with `status`. */
export function canPerformOnIncident(
  role: IncidentRole | null | undefined,
  operation: IncidentOperation,
  status: IncidentStatus | null | undefined,
): boolean {
  if (status === 'Closed' && isBlockedWhenClosed(operation)) return false
  return canPerform(role, operation)
}
