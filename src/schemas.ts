/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { aiChatSchemas } from './schemas/ai-chat-schema'
import { incidentsSchema } from './schemas/incidents-schema'
import { teamMembersSchema } from './schemas/team-members-schema'
import { evidenceSchema } from './schemas/evidence-schema'
import { timelineEventsSchema } from './schemas/timeline-events-schema'
import { hypothesesSchema } from './schemas/hypotheses-schema'
import { evidenceLinksSchema } from './schemas/evidence-links-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  incidentsSchema,
  teamMembersSchema,
  evidenceSchema,
  timelineEventsSchema,
  hypothesesSchema,
  evidenceLinksSchema,
  ...aiChatSchemas,
]
