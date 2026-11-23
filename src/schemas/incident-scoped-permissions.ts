import type { RolePermissions } from 'deepspace/schema'

/**
 * Permissions for every incident-scoped collection (ARCHITECTURE_PROPOSAL §3).
 *
 * - Reads: only active members of the record's incident team (`teamField:
 *   'incidentId'`, resolved by the RecordRoom from `team_members`). The app
 *   `admin` role gets no extra access: it is also `'team'`.
 * - Writes: disabled for every role. All mutations go through server actions,
 *   which enforce the Owner/Investigator/Viewer policy.
 */
export const INCIDENT_SCOPED_PERMISSIONS: Record<string, RolePermissions> = {
  '*': { read: false, create: false, update: false, delete: false },
  viewer: { read: 'team', create: false, update: false, delete: false },
  member: { read: 'team', create: false, update: false, delete: false },
  admin: { read: 'team', create: false, update: false, delete: false },
}
