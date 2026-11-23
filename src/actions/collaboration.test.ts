import { beforeEach, describe, expect, it } from 'vitest'
import {
  authorizeIncidentPresence,
  incidentPresenceScope,
  parseIncidentPresenceScope,
} from '../server/incident-presence'
import { callAs, fakeTools, FakeDb, FakePresenceNamespace } from './test-support'
import type { Env } from '../../worker'

const OWNER = 'user-owner'
const INVESTIGATOR = 'user-investigator'
const VIEWER = 'user-viewer'
const OUTSIDER = 'user-outsider'
const REMOVED = 'user-removed'

let db: FakeDb
let incidentA: string
let incidentB: string

function ok(result: Awaited<ReturnType<typeof callAs>>, key: string): string {
  if (!result.success) throw new Error(result.error)
  return (result.data as Record<string, string>)[key]
}

async function createIncident(owner: string): Promise<string> {
  return ok(
    await callAs(db, owner, 'createIncident', {
      title: 'Outage', description: 'x', category: 'x', severity: 'Low',
      initialTimestamp: '2026-11-22T18:00:00.000Z',
    }),
    'incidentId',
  )
}

function member(incidentId: string, userId: string, role: string, status = 'active') {
  db.seed('team_members', `${incidentId}:${userId}`, { teamId: incidentId, userId, role, status })
}

beforeEach(async () => {
  db = new FakeDb()
  incidentA = await createIncident(OWNER)
  incidentB = await createIncident(OUTSIDER)
  member(incidentA, INVESTIGATOR, 'Investigator')
  member(incidentA, VIEWER, 'Viewer')
  member(incidentA, REMOVED, 'Investigator', 'removed')
})

describe('incident presence authorization', () => {
  const join = (userId: string | null, scope: string | undefined) =>
    authorizeIncidentPresence(fakeTools(db, userId ?? ''), userId, scope)

  it('admits every active member of the incident, scoped to that incident', async () => {
    for (const user of [OWNER, INVESTIGATOR, VIEWER]) {
      expect(await join(user, incidentPresenceScope(incidentA)))
        .toEqual({ allowed: true, incidentId: incidentA, scope: `incident:${incidentA}` })
    }
  })

  it('rejects non-members, removed members and anonymous callers', async () => {
    expect(await join(OUTSIDER, incidentPresenceScope(incidentA))).toEqual({ allowed: false, status: 403 })
    expect(await join(REMOVED, incidentPresenceScope(incidentA))).toEqual({ allowed: false, status: 403 })
    expect(await join(null, incidentPresenceScope(incidentA))).toEqual({ allowed: false, status: 401 })
  })

  it('keeps incidents isolated: membership of A does not admit to B', async () => {
    expect(await join(OWNER, incidentPresenceScope(incidentB))).toEqual({ allowed: false, status: 403 })
    expect(await join(OUTSIDER, incidentPresenceScope(incidentB))).toMatchObject({ allowed: true })
  })

  it('refuses non-incident, malformed and unknown scopes', async () => {
    for (const scope of [undefined, '', 'canvas:x', 'app:whatever', 'incident:', 'incident:../x', 'incident:a b']) {
      expect(await join(OWNER, scope)).toEqual({ allowed: false, status: 404 })
    }
    expect(await join(OWNER, 'incident:does-not-exist')).toEqual({ allowed: false, status: 403 })
    expect(parseIncidentPresenceScope(`incident:${incidentA}`)).toBe(incidentA)
  })

  it('still admits members to a closed incident (read-only, not hidden)', async () => {
    await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Closed' })
    expect(await join(VIEWER, incidentPresenceScope(incidentA))).toMatchObject({ allowed: true })
  })
})

describe('presence eviction on removal', () => {
  it('evicts a removed member from that incident’s presence room only', async () => {
    const presence = new FakePresenceNamespace()
    const env = { PRESENCE_ROOMS: presence } as unknown as Partial<Env>
    const result = await callAs(db, OWNER, 'updateIncidentMember', {
      incidentId: incidentA, userId: INVESTIGATOR, status: 'removed',
    }, env)
    expect(result).toMatchObject({ success: true })
    expect(presence.requests).toEqual([
      { room: `incident:${incidentA}`, path: '/internal/evict-user', body: { userId: INVESTIGATOR } },
    ])
    expect(await authorizeIncidentPresence(fakeTools(db, INVESTIGATOR), INVESTIGATOR, `incident:${incidentA}`))
      .toEqual({ allowed: false, status: 403 })
  })

  it('does not evict on a role change, or when the removal is refused', async () => {
    const presence = new FakePresenceNamespace()
    const env = { PRESENCE_ROOMS: presence } as unknown as Partial<Env>
    await callAs(db, OWNER, 'updateIncidentMember', { incidentId: incidentA, userId: VIEWER, role: 'Investigator' }, env)
    await callAs(db, INVESTIGATOR, 'updateIncidentMember', { incidentId: incidentA, userId: VIEWER, status: 'removed' }, env)
    expect(presence.requests).toEqual([])
  })
})

describe('record deletion', () => {
  async function seedGraph(incidentId: string, userId: string) {
    const evidenceId = ok(await callAs(db, userId, 'createEvidence', {
      incidentId, title: 'graph', description: 'd', type: 'Metric',
    }), 'evidenceId')
    const otherEvidenceId = ok(await callAs(db, userId, 'createEvidence', {
      incidentId, title: 'log', description: 'd', type: 'Log',
    }), 'evidenceId')
    const hypothesisId = ok(await callAs(db, userId, 'createHypothesis', {
      incidentId, title: 'h', explanation: 'e',
    }), 'hypothesisId')
    const eventId = ok(await callAs(db, userId, 'createTimelineEvent', {
      incidentId, title: 't', occurredAt: '2026-11-22T18:00:00Z', sourceEvidenceId: evidenceId,
    }), 'timelineEventId')
    for (const [ev, relationship] of [[evidenceId, 'Supports'], [otherEvidenceId, 'Contradicts']]) {
      ok(await callAs(db, userId, 'setEvidenceLink', { incidentId, evidenceId: ev, hypothesisId, relationship }), 'evidenceLinkId')
    }
    return { evidenceId, otherEvidenceId, hypothesisId, eventId }
  }

  it('deletes evidence, its links, and clears (not deletes) citing timeline events', async () => {
    const g = await seedGraph(incidentA, OWNER)
    const result = await callAs(db, INVESTIGATOR, 'deleteEvidence', { incidentId: incidentA, evidenceId: g.evidenceId })
    expect(result).toMatchObject({ success: true, data: { removedLinks: 1, clearedTimelineReferences: 1 } })
    expect(db.table('evidence').has(g.evidenceId)).toBe(false)
    expect(db.rows('evidence_links').map((row) => row.data.evidenceId)).toEqual([g.otherEvidenceId])
    expect(db.table('timeline_events').get(g.eventId)!.data.sourceEvidenceId).toBe('')
  })

  it('deletes a hypothesis together with all of its links', async () => {
    const g = await seedGraph(incidentA, OWNER)
    expect(await callAs(db, OWNER, 'deleteHypothesis', { incidentId: incidentA, hypothesisId: g.hypothesisId }))
      .toMatchObject({ success: true, data: { removedLinks: 2 } })
    expect(db.table('hypotheses').has(g.hypothesisId)).toBe(false)
    expect(db.rows('evidence_links')).toHaveLength(0)
    expect(db.rows('evidence')).toHaveLength(2)
  })

  it('deletes timeline events', async () => {
    const g = await seedGraph(incidentA, OWNER)
    expect(await callAs(db, INVESTIGATOR, 'deleteTimelineEvent', { incidentId: incidentA, timelineEventId: g.eventId }))
      .toMatchObject({ success: true })
    expect(db.rows('timeline_events')).toHaveLength(0)
  })

  it('never removes another incident’s links during cleanup', async () => {
    const a = await seedGraph(incidentA, OWNER)
    await seedGraph(incidentB, OUTSIDER)
    await callAs(db, OWNER, 'deleteHypothesis', { incidentId: incidentA, hypothesisId: a.hypothesisId })
    const remaining = db.rows('evidence_links')
    expect(remaining).toHaveLength(2)
    expect(remaining.every((row) => row.data.incidentId === incidentB)).toBe(true)
  })

  it('denies viewers, non-members and removed members, leaving records intact', async () => {
    const g = await seedGraph(incidentA, OWNER)
    const attempts = [
      ['deleteEvidence', { evidenceId: g.evidenceId }],
      ['deleteHypothesis', { hypothesisId: g.hypothesisId }],
      ['deleteTimelineEvent', { timelineEventId: g.eventId }],
      ['removeEvidenceLink', { evidenceId: g.evidenceId, hypothesisId: g.hypothesisId }],
    ] as const
    for (const [name, ids] of attempts) {
      expect(await callAs(db, VIEWER, name, { incidentId: incidentA, ...ids })).toMatchObject({ success: false, code: 'forbidden' })
      for (const user of [OUTSIDER, REMOVED]) {
        expect(await callAs(db, user, name, { incidentId: incidentA, ...ids })).toMatchObject({ success: false, code: 'not_found' })
      }
    }
    expect(db.rows('evidence')).toHaveLength(2)
    expect(db.rows('hypotheses')).toHaveLength(1)
    expect(db.rows('timeline_events')).toHaveLength(1)
    expect(db.rows('evidence_links')).toHaveLength(2)
  })

  it('denies every deletion on a closed incident, Owner included', async () => {
    const g = await seedGraph(incidentA, OWNER)
    await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Closed' })
    for (const [name, ids] of [
      ['deleteEvidence', { evidenceId: g.evidenceId }],
      ['deleteHypothesis', { hypothesisId: g.hypothesisId }],
      ['deleteTimelineEvent', { timelineEventId: g.eventId }],
      ['removeEvidenceLink', { evidenceId: g.evidenceId, hypothesisId: g.hypothesisId }],
    ] as const) {
      expect(await callAs(db, OWNER, name, { incidentId: incidentA, ...ids }))
        .toMatchObject({ success: false, code: 'incident_closed' })
    }
    expect(db.rows('evidence_links')).toHaveLength(2)
    expect(db.table('timeline_events').get(g.eventId)!.data.sourceEvidenceId).toBe(g.evidenceId)
  })

  it('rejects deleting another incident’s records through an incident the caller belongs to', async () => {
    const b = await seedGraph(incidentB, OUTSIDER)
    for (const [name, ids] of [
      ['deleteEvidence', { evidenceId: b.evidenceId }],
      ['deleteHypothesis', { hypothesisId: b.hypothesisId }],
      ['deleteTimelineEvent', { timelineEventId: b.eventId }],
      ['removeEvidenceLink', { evidenceId: b.evidenceId, hypothesisId: b.hypothesisId }],
    ] as const) {
      expect(await callAs(db, OWNER, name, { incidentId: incidentA, ...ids }))
        .toMatchObject({ success: false, code: 'not_found' })
    }
    expect(db.rows('evidence').filter((row) => row.data.incidentId === incidentB)).toHaveLength(2)
    expect(db.rows('evidence_links')).toHaveLength(2)
  })
})
