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
import { action, ensureWrite, requireNonEmptyPatch, type Params } from './shared'

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
}
