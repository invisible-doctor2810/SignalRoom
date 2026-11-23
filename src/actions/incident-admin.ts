import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  ASSIGNABLE_ROLES,
  INCIDENT_SEVERITIES,
  LIMITS,
  MEMBERSHIP_STATUSES,
  SETTABLE_INCIDENT_STATUSES,
  membershipRecordId,
  type IncidentData,
  type IncidentMemberView,
  type TeamMemberData,
} from '../domain/incident-model'
import { INCIDENT_CLOSED_MESSAGE } from '../domain/authorization'
import { email, has, oneOf, recordId, requiredText, timestamp, ValidationError } from '../domain/validation'
import { AccessError, requireIncidentAccess } from '../server/incident-access'
import { evictFromIncidentPresence } from '../server/incident-presence'
import { action, ensureWrite, requireNonEmptyPatch, type Params } from './shared'

async function findUserIdByEmail(tools: ActionTools, address: string): Promise<string | null> {
  const result = await tools.query<Record<string, unknown>>('users', { where: { email: address }, limit: 1 })
  if (!result.success || result.data.records.length === 0) return null
  return result.data.records[0].recordId
}

async function loadMembership(tools: ActionTools, incidentId: string, userId: string) {
  const id = membershipRecordId(incidentId, userId)
  const result = await tools.get<Record<string, unknown>>('team_members', id)
  if (!result.success) return null
  const data = result.data.record.data as unknown as TeamMemberData
  if (data.teamId !== incidentId || data.userId !== userId) return null
  return { id, data }
}

export const incidentAdminActions: Record<string, ActionHandler<Env>> = {
  updateIncident: action('updateIncident', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const access = await requireIncidentAccess(tools, userId, incidentId, 'incident.update')

    // A closed incident is read-only: the Owner may only reopen it, with a
    // status-only change. Other edits are accepted after it is reopened.
    if (access.incident.status === 'Closed') {
      const keys = ['title', 'description', 'category', 'severity', 'status', 'initialTimestamp']
        .filter((key) => has(input, key))
      const reopening = keys.length === 1 && keys[0] === 'status' && input.status !== 'Closed'
      if (!reopening) throw new AccessError(INCIDENT_CLOSED_MESSAGE, 'incident_closed')
    }

    const patch: Partial<IncidentData> = {}
    if (has(input, 'title')) patch.title = requiredText(input.title, 'Title', LIMITS.title)
    if (has(input, 'description')) {
      patch.description = requiredText(input.description, 'Description', LIMITS.description)
    }
    if (has(input, 'category')) patch.category = requiredText(input.category, 'Category', LIMITS.category)
    if (has(input, 'severity')) patch.severity = oneOf(input.severity, INCIDENT_SEVERITIES, 'severity')
    if (has(input, 'status')) patch.status = oneOf(input.status, SETTABLE_INCIDENT_STATUSES, 'status')
    if (has(input, 'initialTimestamp')) {
      patch.initialTimestamp = timestamp(input.initialTimestamp, 'Initial timestamp')
    }
    requireNonEmptyPatch(patch)

    ensureWrite(await tools.update('incidents', incidentId, patch), 'Failed to update incident')
    return { success: true, data: { incidentId } }
  }),

  /** Members of one incident, visible to any active member of it. */
  listIncidentMembers: action('listIncidentMembers', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const access = await requireIncidentAccess(tools, userId, incidentId, 'members.read')
    const isOwner = access.role === 'Owner'

    const result = await tools.query<Record<string, unknown>>('team_members', {
      where: { teamId: incidentId },
      limit: 200,
    })
    if (!result.success) throw new Error('Failed to load members')

    const members: IncidentMemberView[] = []
    for (const record of result.data.records) {
      const member = record.data as unknown as TeamMemberData
      if (member.teamId !== incidentId) continue
      // Removed members are membership history; only the Owner sees them.
      if (member.status !== 'active' && !isOwner) continue
      const user = await tools.get<Record<string, unknown>>('users', member.userId)
      const userData = user.success ? user.data.record.data : {}
      const view: IncidentMemberView = {
        userId: member.userId,
        name: typeof userData.name === 'string' && userData.name ? userData.name : 'Unknown user',
        role: member.role,
        status: member.status,
      }
      if (isOwner && typeof userData.email === 'string') view.email = userData.email
      members.push(view)
    }
    return { success: true, data: { members, callerRole: access.role } }
  }),

  /** Owner adds an existing SignalRoom user (by email) as Investigator or Viewer. */
  addIncidentMember: action('addIncidentMember', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const address = email(input.email)
    const role = oneOf(input.role, ASSIGNABLE_ROLES, 'role')
    await requireIncidentAccess(tools, userId, incidentId, 'members.manage')

    const targetUserId = await findUserIdByEmail(tools, address)
    if (!targetUserId) {
      throw new ValidationError('No SignalRoom user has that email. They must sign in to SignalRoom once first.')
    }
    if (targetUserId === userId) throw new ValidationError('You are already the owner of this incident')

    const existing = await loadMembership(tools, incidentId, targetUserId)
    if (existing?.data.status === 'active') throw new ValidationError('That user is already a member')
    if (existing) {
      ensureWrite(
        await tools.update('team_members', existing.id, { role, status: 'active' }),
        'Failed to restore membership',
      )
    } else {
      const data: TeamMemberData = { teamId: incidentId, userId: targetUserId, role, status: 'active' }
      ensureWrite(
        await tools.create('team_members', { ...data }, membershipRecordId(incidentId, targetUserId)),
        'Failed to add member',
      )
    }
    return { success: true, data: { userId: targetUserId, role } }
  }),

  /** Owner changes a member's role or removes/restores them. The Owner row is immutable here. */
  updateIncidentMember: action('updateIncidentMember', async ({ userId, params, tools, env }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const memberUserId = recordId(input.userId, 'Member')
    await requireIncidentAccess(tools, userId, incidentId, 'members.manage')

    const existing = await loadMembership(tools, incidentId, memberUserId)
    if (!existing) throw new AccessError('Member not found', 'not_found')
    if (existing.data.role === 'Owner' || memberUserId === userId) {
      throw new AccessError("The incident owner's membership cannot be changed", 'forbidden')
    }

    const patch: Partial<TeamMemberData> = {}
    if (has(input, 'role')) patch.role = oneOf(input.role, ASSIGNABLE_ROLES, 'role')
    if (has(input, 'status')) patch.status = oneOf(input.status, MEMBERSHIP_STATUSES, 'membership status')
    requireNonEmptyPatch(patch)

    ensureWrite(await tools.update('team_members', existing.id, patch), 'Failed to update member')
    // The membership row is what revokes access; also drop any live presence
    // sockets so the removed member disappears from the room immediately.
    if (patch.status === 'removed') {
      await evictFromIncidentPresence(env.PRESENCE_ROOMS, incidentId, memberUserId)
    }
    return { success: true, data: { userId: memberUserId } }
  }),
}
