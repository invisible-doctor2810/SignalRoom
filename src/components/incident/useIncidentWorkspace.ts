import { useCallback, useMemo } from 'react'
import { useQuery, useUser, useUsers } from 'deepspace'
import type { RecordData } from 'deepspace'
import { canPerformOnIncident, type IncidentOperation } from '@/domain/authorization'
import type {
  EvidenceData,
  EvidenceLinkData,
  HypothesisData,
  IncidentData,
  IncidentRole,
  TeamMemberData,
  TimelineEventData,
} from '@/domain/incident-model'

/**
 * Everything the workspace renders for one incident. Every query is filtered
 * by incident id, and the RecordRoom additionally only returns rows of
 * incidents the caller is an active team member of (`read: 'team'`), so a
 * non-member receives nothing — regardless of what this hook asks for.
 *
 * `role` drives which controls are shown; the server re-checks every action.
 */
export function useIncidentWorkspace(incidentId: string) {
  const { user } = useUser()
  const { users } = useUsers()
  const incidents = useQuery<IncidentData>('incidents', { where: { incidentId } })
  // `read: 'own'` (ownerField userId): only the caller's own membership row.
  const memberships = useQuery<TeamMemberData>('team_members', { where: { teamId: incidentId } })
  const evidence = useQuery<EvidenceData>('evidence', {
    where: { incidentId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const timeline = useQuery<TimelineEventData>('timeline_events', { where: { incidentId } })
  const hypotheses = useQuery<HypothesisData>('hypotheses', {
    where: { incidentId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const links = useQuery<EvidenceLinkData>('evidence_links', { where: { incidentId } })

  const incident = incidents.records.find((record) => record.data.incidentId === incidentId) ?? null
  const role: IncidentRole | null = useMemo(() => {
    const own = memberships.records.find(
      (record) => record.data.userId === user?.id && record.data.status === 'active',
    )
    return own?.data.role ?? null
  }, [memberships.records, user?.id])

  const timelineSorted = useMemo(
    () => [...timeline.records].sort((a, b) => Date.parse(a.data.occurredAt) - Date.parse(b.data.occurredAt)),
    [timeline.records],
  )

  const evidenceById = useMemo(() => {
    const map = new Map<string, RecordData<EvidenceData>>()
    for (const record of evidence.records) map.set(record.recordId, record)
    return map
  }, [evidence.records])

  const userName = useCallback(
    (userId: string) => {
      if (userId === user?.id) return user?.name || 'You'
      return users.find((candidate) => candidate.id === userId)?.name || 'Unknown user'
    },
    [user?.id, user?.name, users],
  )

  const status = incident?.data.status ?? null
  const can = useCallback(
    (operation: IncidentOperation) => canPerformOnIncident(role, operation, status),
    [role, status],
  )

  const loading = [incidents, memberships, evidence, timeline, hypotheses, links].some(
    (query) => query.status === 'loading',
  )
  const failed = [incidents, memberships, evidence, timeline, hypotheses, links].find(
    (query) => query.status === 'error',
  )

  return {
    incidentId,
    incident,
    role,
    can,
    isClosed: status === 'Closed',
    loading,
    error: failed?.error ?? (failed ? 'Failed to load incident data' : null),
    evidence: evidence.records,
    evidenceById,
    timeline: timelineSorted,
    hypotheses: hypotheses.records,
    links: links.records,
    userName,
    currentUserId: user?.id ?? null,
  }
}

export type IncidentWorkspace = ReturnType<typeof useIncidentWorkspace>
