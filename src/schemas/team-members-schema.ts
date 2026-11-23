import type { CollectionSchema } from 'deepspace/schema'

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  uniqueOn: ['teamId', 'userId'],
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'role', storage: 'text', interpretation: { kind: 'select', options: ['Owner', 'Investigator', 'Viewer'] }, required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'removed'] }, required: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
