import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  EVIDENCE_TYPES,
  LIMITS,
  VERIFICATION_STATUSES,
  type EvidenceData,
} from '../domain/incident-model'
import { has, oneOf, optionalText, recordId, requiredText } from '../domain/validation'
import { loadIncidentRecord, requireIncidentAccess } from '../server/incident-access'
import { action, deleteAllWhere, ensureWrite, requireNonEmptyPatch, type Params } from './shared'

export const evidenceActions: Record<string, ActionHandler<Env>> = {
  createEvidence: action('createEvidence', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    await requireIncidentAccess(tools, userId, incidentId, 'evidence.write')

    const data: EvidenceData = {
      incidentId,
      title: requiredText(input.title, 'Title', LIMITS.title),
      description: requiredText(input.description, 'Description', LIMITS.description),
      type: oneOf(input.type, EVIDENCE_TYPES, 'evidence type'),
      source: optionalText(input.source, 'Source', LIMITS.source),
      verificationStatus: has(input, 'verificationStatus')
        ? oneOf(input.verificationStatus, VERIFICATION_STATUSES, 'verification status')
        : 'Unverified',
    }
    const created = ensureWrite(await tools.create('evidence', { ...data }), 'Failed to create evidence')
    return { success: true, data: { evidenceId: created.recordId } }
  }),

  updateEvidence: action('updateEvidence', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const evidenceId = recordId(input.evidenceId, 'Evidence')
    await requireIncidentAccess(tools, userId, incidentId, 'evidence.write')
    await loadIncidentRecord<EvidenceData>(tools, 'evidence', evidenceId, incidentId, 'Evidence')

    const patch: Partial<EvidenceData> = {}
    if (has(input, 'title')) patch.title = requiredText(input.title, 'Title', LIMITS.title)
    if (has(input, 'description')) {
      patch.description = requiredText(input.description, 'Description', LIMITS.description)
    }
    if (has(input, 'type')) patch.type = oneOf(input.type, EVIDENCE_TYPES, 'evidence type')
    if (has(input, 'source')) patch.source = optionalText(input.source, 'Source', LIMITS.source)
    if (has(input, 'verificationStatus')) {
      patch.verificationStatus = oneOf(input.verificationStatus, VERIFICATION_STATUSES, 'verification status')
    }
    requireNonEmptyPatch(patch)

    ensureWrite(await tools.update('evidence', evidenceId, patch), 'Failed to update evidence')
    return { success: true, data: { evidenceId } }
  }),

  /**
   * Deletes evidence. Dependents are handled first so a partial failure never
   * leaves a reference to missing evidence: its hypothesis links are removed
   * and timeline events that cited it keep their content but lose the citation.
   */
  deleteEvidence: action('deleteEvidence', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const evidenceId = recordId(input.evidenceId, 'Evidence')
    await requireIncidentAccess(tools, userId, incidentId, 'evidence.write')
    await loadIncidentRecord<EvidenceData>(tools, 'evidence', evidenceId, incidentId, 'Evidence')

    const removedLinks = await deleteAllWhere(tools, 'evidence_links', { incidentId, evidenceId })

    // Cleared events stop matching, so each round fetches the next batch.
    let clearedTimelineReferences = 0
    for (let round = 0; ; round += 1) {
      if (round >= 50) throw new Error('Too many timeline references to clean up')
      const citing = await tools.query<Record<string, unknown>>('timeline_events', {
        where: { incidentId, sourceEvidenceId: evidenceId },
        limit: 100,
      })
      if (!citing.success) throw new Error('Failed to load timeline references')
      if (citing.data.records.length === 0) break
      for (const event of citing.data.records) {
        ensureWrite(
          await tools.update('timeline_events', event.recordId, { sourceEvidenceId: '' }),
          'Failed to clear timeline reference',
        )
        clearedTimelineReferences += 1
      }
    }

    ensureWrite(await tools.remove('evidence', evidenceId), 'Failed to delete evidence')
    return { success: true, data: { evidenceId, removedLinks, clearedTimelineReferences } }
  }),
}
