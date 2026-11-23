import type { CollectionSchema } from 'deepspace/schema'

export const incidentsSchema: CollectionSchema = {
  name: 'incidents',
  teamField: 'incidentId',
  columns: [
    { name: 'incidentId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'description', storage: 'text', interpretation: 'plain', required: true },
    { name: 'category', storage: 'text', interpretation: 'plain', required: true },
    { name: 'severity', storage: 'text', interpretation: { kind: 'select', options: ['Low', 'Medium', 'High', 'Critical'] }, required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['Creating', 'Open', 'Investigating', 'Resolved', 'Closed'] }, required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'initialTimestamp', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: 'team', create: false, update: false, delete: false },
  },
}
