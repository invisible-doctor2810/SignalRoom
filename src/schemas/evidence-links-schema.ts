import type { CollectionSchema } from 'deepspace/schema'
import { EVIDENCE_RELATIONSHIPS } from '../domain/incident-model'
import { INCIDENT_SCOPED_PERMISSIONS } from './incident-scoped-permissions'

/**
 * Evidence ↔ hypothesis relationships. One link per pair (`uniqueOn`); both
 * ends must belong to the same incident as the link (checked server-side).
 */
export const evidenceLinksSchema: CollectionSchema = {
  name: 'evidence_links',
  teamField: 'incidentId',
  uniqueOn: ['evidenceId', 'hypothesisId'],
  columns: [
    { name: 'incidentId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'evidenceId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'hypothesisId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'relationship',
      storage: 'text',
      interpretation: { kind: 'select', options: [...EVIDENCE_RELATIONSHIPS] },
      required: true,
    },
  ],
  permissions: INCIDENT_SCOPED_PERMISSIONS,
}
