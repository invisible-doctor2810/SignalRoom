import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  EVIDENCE_RELATIONSHIPS,
  HYPOTHESIS_STATUSES,
  LIMITS,
  evidenceLinkRecordId,
  type EvidenceData,
  type EvidenceLinkData,
  type HypothesisData,
} from '../domain/incident-model'
import { has, oneOf, recordId, requiredText } from '../domain/validation'
import { loadIncidentRecord, requireIncidentAccess } from '../server/incident-access'
import { action, ensureWrite, requireNonEmptyPatch, type Params } from './shared'

export const hypothesisActions: Record<string, ActionHandler<Env>> = {
  createHypothesis: action('createHypothesis', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    await requireIncidentAccess(tools, userId, incidentId, 'hypothesis.write')

    const data: HypothesisData = {
      incidentId,
      title: requiredText(input.title, 'Title', LIMITS.title),
      explanation: requiredText(input.explanation, 'Explanation', LIMITS.description),
      status: has(input, 'status') ? oneOf(input.status, HYPOTHESIS_STATUSES, 'hypothesis status') : 'Proposed',
    }
    const created = ensureWrite(await tools.create('hypotheses', { ...data }), 'Failed to create hypothesis')
    return { success: true, data: { hypothesisId: created.recordId } }
  }),

  updateHypothesis: action('updateHypothesis', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const hypothesisId = recordId(input.hypothesisId, 'Hypothesis')
    await requireIncidentAccess(tools, userId, incidentId, 'hypothesis.write')
    await loadIncidentRecord<HypothesisData>(tools, 'hypotheses', hypothesisId, incidentId, 'Hypothesis')

    const patch: Partial<HypothesisData> = {}
    if (has(input, 'title')) patch.title = requiredText(input.title, 'Title', LIMITS.title)
    if (has(input, 'explanation')) {
      patch.explanation = requiredText(input.explanation, 'Explanation', LIMITS.description)
    }
    if (has(input, 'status')) patch.status = oneOf(input.status, HYPOTHESIS_STATUSES, 'hypothesis status')
    requireNonEmptyPatch(patch)

    ensureWrite(await tools.update('hypotheses', hypothesisId, patch), 'Failed to update hypothesis')
    return { success: true, data: { hypothesisId } }
  }),

  /** Creates or changes the relationship between one evidence item and one hypothesis. */
  setEvidenceLink: action('setEvidenceLink', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const evidenceId = recordId(input.evidenceId, 'Evidence')
    const hypothesisId = recordId(input.hypothesisId, 'Hypothesis')
    const relationship = oneOf(input.relationship, EVIDENCE_RELATIONSHIPS, 'relationship')
    await requireIncidentAccess(tools, userId, incidentId, 'evidenceLink.write')
    // Both ends must belong to this incident: no cross-incident links.
    await loadIncidentRecord<EvidenceData>(tools, 'evidence', evidenceId, incidentId, 'Evidence')
    await loadIncidentRecord<HypothesisData>(tools, 'hypotheses', hypothesisId, incidentId, 'Hypothesis')

    const linkId = evidenceLinkRecordId(evidenceId, hypothesisId)
    const existing = await tools.get<Record<string, unknown>>('evidence_links', linkId)
    if (existing.success) {
      const current = existing.data.record.data as unknown as EvidenceLinkData
      if (current.incidentId !== incidentId) throw new Error('Evidence link belongs to another incident')
      ensureWrite(await tools.update('evidence_links', linkId, { relationship }), 'Failed to update evidence link')
    } else {
      const data: EvidenceLinkData = { incidentId, evidenceId, hypothesisId, relationship }
      ensureWrite(await tools.create('evidence_links', { ...data }, linkId), 'Failed to create evidence link')
    }
    return { success: true, data: { evidenceLinkId: linkId } }
  }),

  removeEvidenceLink: action('removeEvidenceLink', async ({ userId, params, tools }) => {
    const input = params as Params
    const incidentId = recordId(input.incidentId, 'Incident')
    const evidenceId = recordId(input.evidenceId, 'Evidence')
    const hypothesisId = recordId(input.hypothesisId, 'Hypothesis')
    await requireIncidentAccess(tools, userId, incidentId, 'evidenceLink.write')

    const linkId = evidenceLinkRecordId(evidenceId, hypothesisId)
    await loadIncidentRecord<EvidenceLinkData>(tools, 'evidence_links', linkId, incidentId, 'Evidence link')
    ensureWrite(await tools.remove('evidence_links', linkId), 'Failed to remove evidence link')
    return { success: true, data: { evidenceLinkId: linkId } }
  }),
}
