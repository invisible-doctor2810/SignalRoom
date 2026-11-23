import type { CollectionSchema } from 'deepspace/schema'
import { LIMITS } from '../domain/incident-model'
import { INCIDENT_SCOPED_PERMISSIONS } from './incident-scoped-permissions'

/** Timeline events; `sourceEvidenceId` optionally references `evidence`. */
export const timelineEventsSchema: CollectionSchema = {
  name: 'timeline_events',
  teamField: 'incidentId',
  columns: [
    { name: 'incidentId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: LIMITS.title },
    { name: 'description', storage: 'text', interpretation: 'plain', maxLength: LIMITS.description },
    { name: 'occurredAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'sourceEvidenceId', storage: 'text', interpretation: 'plain' },
    { name: 'important', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  permissions: INCIDENT_SCOPED_PERMISSIONS,
}
