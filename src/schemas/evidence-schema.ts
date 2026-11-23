import type { CollectionSchema } from 'deepspace/schema'
import { EVIDENCE_TYPES, LIMITS, VERIFICATION_STATUSES } from '../domain/incident-model'
import { INCIDENT_SCOPED_PERMISSIONS } from './incident-scoped-permissions'

/** Evidence items. Creator attribution is the system `createdBy` field. */
export const evidenceSchema: CollectionSchema = {
  name: 'evidence',
  teamField: 'incidentId',
  columns: [
    { name: 'incidentId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: LIMITS.title },
    { name: 'description', storage: 'text', interpretation: 'plain', required: true, maxLength: LIMITS.description },
    { name: 'type', storage: 'text', interpretation: { kind: 'select', options: [...EVIDENCE_TYPES] }, required: true },
    { name: 'source', storage: 'text', interpretation: 'plain', maxLength: LIMITS.source },
    {
      name: 'verificationStatus',
      storage: 'text',
      interpretation: { kind: 'select', options: [...VERIFICATION_STATUSES] },
      required: true,
    },
  ],
  permissions: INCIDENT_SCOPED_PERMISSIONS,
}
