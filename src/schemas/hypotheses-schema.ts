import type { CollectionSchema } from 'deepspace/schema'
import { HYPOTHESIS_STATUSES, LIMITS } from '../domain/incident-model'
import { INCIDENT_SCOPED_PERMISSIONS } from './incident-scoped-permissions'

export const hypothesesSchema: CollectionSchema = {
  name: 'hypotheses',
  teamField: 'incidentId',
  columns: [
    { name: 'incidentId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: LIMITS.title },
    { name: 'explanation', storage: 'text', interpretation: 'plain', required: true, maxLength: LIMITS.description },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...HYPOTHESIS_STATUSES] }, required: true },
  ],
  permissions: INCIDENT_SCOPED_PERMISSIONS,
}
