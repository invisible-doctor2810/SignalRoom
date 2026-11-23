import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

type IncidentStatus = 'Creating' | 'Open' | 'Investigating' | 'Resolved' | 'Closed'
type IncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical'

interface CreateIncidentParams {
  title?: unknown
  description?: unknown
  category?: unknown
  severity?: unknown
  initialTimestamp?: unknown
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${name} is required`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  if (normalized.length > maxLength) throw new Error(`${name} is too long`)
  return normalized
}

export const actions: Record<string, ActionHandler<Env>> = {
  createIncident: async ({ userId, params, tools }) => {
    try {
      const input = params as CreateIncidentParams
      const title = text(input.title, 'Title', 160)
      const description = text(input.description, 'Description', 4000)
      const category = text(input.category, 'Category', 80)
      const severity = input.severity
      if (severity !== 'Low' && severity !== 'Medium' && severity !== 'High' && severity !== 'Critical') {
        return { success: false, error: 'Invalid severity' }
      }
      const initialTimestamp = text(input.initialTimestamp, 'Initial timestamp', 40)
      if (Number.isNaN(Date.parse(initialTimestamp))) {
        return { success: false, error: 'Invalid initial timestamp' }
      }

      const incidentId = crypto.randomUUID()
      const membershipId = `${incidentId}:${userId}`

      const incidentResult = await tools.create('incidents', {
        incidentId,
        title,
        description,
        category,
        severity: severity as IncidentSeverity,
        status: 'Creating' satisfies IncidentStatus,
        ownerId: userId,
        initialTimestamp,
      }, incidentId)

      if (!incidentResult.success) {
        return { success: false, error: 'Failed to create incident root' }
      }

      const membershipResult = await tools.create('team_members', {
        teamId: incidentId,
        userId,
        role: 'Owner',
        status: 'active',
      }, membershipId)

      if (!membershipResult.success) {
        await tools.remove('incidents', incidentId)
        return { success: false, error: 'Failed to create owner membership; incident creation was rolled back' }
      }

      const ownerCheck = await tools.get('team_members', membershipId)
      const incidentCheck = await tools.get('incidents', incidentId)
      if (!ownerCheck.success || !incidentCheck.success) {
        await tools.remove('team_members', membershipId)
        await tools.remove('incidents', incidentId)
        return { success: false, error: 'Incident creation could not be verified; changes were rolled back' }
      }

      const published = await tools.update('incidents', incidentId, { status: 'Open' })
      if (!published.success) {
        await tools.remove('team_members', membershipId)
        await tools.remove('incidents', incidentId)
        return { success: false, error: 'Failed to publish incident; changes were rolled back' }
      }

      return {
        success: true,
        data: { incidentId },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid incident'
      return { success: false, error: message }
    }
  },
}
