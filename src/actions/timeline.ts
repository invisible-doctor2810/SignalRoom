import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { LIMITS, type EvidenceData, type TimelineEventData } from '../domain/incident-model'
import {
  booleanFlag,
  has,
  optionalRecordId,
  optionalText,
  recordId,
  requiredText,
  timestamp,
} from '../domain/validation'
import { loadIncidentRecord, requireIncidentAccess } from '../server/incident-access'
import { action, ensureWrite, requireNonEmptyPatch, type Params } from './shared'
import type { ActionTools } from 'deepspace/worker'

/** An evidence reference must name evidence in the SAME incident. */
async function validEvidenceReference(
  tools: ActionTools,
  value: unknown,
  incidentId: string,
): Promise<string> {
  const evidenceId = optionalRecordId(value, 'Evidence reference')
  if (evidenceId) {
    await loadIncidentRecord<EvidenceData>(tools, 'evidence', evidenceId, incidentId, 'Referenced evidence')
  }
  return evidenceId
}

export const timelineActions: Record<string, ActionHandler<Env>> = {
  createTimelineEvent: action('createTimelineEvent', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    await requireIncidentAccess(tools, userId, incidentId, 'timeline.write')

    const data: TimelineEventData = {
      incidentId,
      title: requiredText(input.title, 'Title', LIMITS.title),
      description: optionalText(input.description, 'Description', LIMITS.description),
      occurredAt: timestamp(input.occurredAt, 'Event time'),
      sourceEvidenceId: await validEvidenceReference(tools, input.sourceEvidenceId, incidentId),
      important: booleanFlag(input.important, 'important flag') ? 1 : 0,
    }
    const created = ensureWrite(
      await tools.create('timeline_events', { ...data }),
      'Failed to create timeline event',
    )
    return { success: true, data: { timelineEventId: created.recordId } }
  }),

  updateTimelineEvent: action('updateTimelineEvent', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const timelineEventId = recordId(input.timelineEventId, 'Timeline event')
    await requireIncidentAccess(tools, userId, incidentId, 'timeline.write')
    await loadIncidentRecord<TimelineEventData>(
      tools,
      'timeline_events',
      timelineEventId,
      incidentId,
      'Timeline event',
    )

    const patch: Partial<TimelineEventData> = {}
    if (has(input, 'title')) patch.title = requiredText(input.title, 'Title', LIMITS.title)
    if (has(input, 'description')) {
      patch.description = optionalText(input.description, 'Description', LIMITS.description)
    }
    if (has(input, 'occurredAt')) patch.occurredAt = timestamp(input.occurredAt, 'Event time')
    if (has(input, 'sourceEvidenceId')) {
      patch.sourceEvidenceId = await validEvidenceReference(tools, input.sourceEvidenceId, incidentId)
    }
    if (has(input, 'important')) patch.important = booleanFlag(input.important, 'important flag') ? 1 : 0
    requireNonEmptyPatch(patch)

    ensureWrite(
      await tools.update('timeline_events', timelineEventId, patch),
      'Failed to update timeline event',
    )
    return { success: true, data: { timelineEventId } }
  }),

  /** Timeline events have no dependents. */
  deleteTimelineEvent: action('deleteTimelineEvent', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const timelineEventId = recordId(input.timelineEventId, 'Timeline event')
    await requireIncidentAccess(tools, userId, incidentId, 'timeline.write')
    await loadIncidentRecord<TimelineEventData>(
      tools,
      'timeline_events',
      timelineEventId,
      incidentId,
      'Timeline event',
    )
    ensureWrite(await tools.remove('timeline_events', timelineEventId), 'Failed to delete timeline event')
    return { success: true, data: { timelineEventId } }
  }),
}
