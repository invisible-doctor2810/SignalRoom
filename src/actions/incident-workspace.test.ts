import { beforeEach, describe, expect, it } from 'vitest'
import { canPerform } from '../domain/authorization'
import { INCIDENT_ROLES } from '../domain/incident-model'
import { callAs, FakeDb } from './test-support'

const OWNER = 'user-owner'
const INVESTIGATOR = 'user-investigator'
const VIEWER = 'user-viewer'
const OUTSIDER = 'user-outsider'
const REMOVED = 'user-removed'

let db: FakeDb
let incidentA: string
let incidentB: string

async function createIncident(owner: string, title: string): Promise<string> {
  const result = await callAs(db, owner, 'createIncident', {
    title,
    description: 'Checkout latency spike',
    category: 'Payments',
    severity: 'High',
    initialTimestamp: '2026-11-22T18:00:00.000Z',
  })
  if (!result.success) throw new Error(result.error)
  return (result.data as { incidentId: string }).incidentId
}

function addMember(incidentId: string, userId: string, role: string, status = 'active') {
  db.seed('team_members', `${incidentId}:${userId}`, { teamId: incidentId, userId, role, status })
}

async function createEvidence(userId: string, incidentId: string, extra: Record<string, unknown> = {}) {
  return callAs(db, userId, 'createEvidence', {
    incidentId,
    title: 'p99 latency graph',
    description: 'Latency rose to 4s at 18:02',
    type: 'Metric',
    source: 'Grafana',
    ...extra,
  })
}

function idOf(result: Awaited<ReturnType<typeof callAs>>, key: string): string {
  if (!result.success) throw new Error(result.error)
  return (result.data as Record<string, string>)[key]
}

beforeEach(async () => {
  db = new FakeDb()
  for (const [id, email] of [
    [OWNER, 'owner@example.test'],
    [INVESTIGATOR, 'investigator@example.test'],
    [VIEWER, 'viewer@example.test'],
    [OUTSIDER, 'outsider@example.test'],
    [REMOVED, 'removed@example.test'],
  ]) {
    db.seed('users', id, { name: id, email })
  }
  incidentA = await createIncident(OWNER, 'Incident A')
  incidentB = await createIncident(OUTSIDER, 'Incident B')
  addMember(incidentA, INVESTIGATOR, 'Investigator')
  addMember(incidentA, VIEWER, 'Viewer')
  addMember(incidentA, REMOVED, 'Investigator', 'removed')
})

describe('operation policy', () => {
  it('matches the architecture role table', () => {
    const writes = ['evidence.write', 'timeline.write', 'hypothesis.write', 'evidenceLink.write'] as const
    for (const op of writes) {
      expect(canPerform('Owner', op)).toBe(true)
      expect(canPerform('Investigator', op)).toBe(true)
      expect(canPerform('Viewer', op)).toBe(false)
    }
    for (const op of ['incident.update', 'members.manage'] as const) {
      expect(INCIDENT_ROLES.filter((role) => canPerform(role, op))).toEqual(['Owner'])
    }
    expect(canPerform(null, 'incident.read')).toBe(false)
  })
})

describe('evidence', () => {
  it('lets an investigator create evidence attributed to the verified caller', async () => {
    const result = await createEvidence(INVESTIGATOR, incidentA, { createdBy: OWNER, incidentIdOverride: incidentB })
    const evidenceId = idOf(result, 'evidenceId')
    const row = db.table('evidence').get(evidenceId)!
    expect(row.createdBy).toBe(INVESTIGATOR)
    expect(row.data).toEqual({
      incidentId: incidentA,
      title: 'p99 latency graph',
      description: 'Latency rose to 4s at 18:02',
      type: 'Metric',
      source: 'Grafana',
      verificationStatus: 'Unverified',
    })
  })

  it('denies viewers, outsiders and removed members', async () => {
    const viewer = await createEvidence(VIEWER, incidentA)
    expect(viewer).toMatchObject({ success: false, code: 'forbidden' })
    for (const user of [OUTSIDER, REMOVED]) {
      expect(await createEvidence(user, incidentA)).toMatchObject({ success: false, code: 'not_found' })
    }
    expect(db.rows('evidence')).toHaveLength(0)
  })

  it('rejects updates to evidence from another incident', async () => {
    const foreign = idOf(await createEvidence(OUTSIDER, incidentB), 'evidenceId')
    const result = await callAs(db, OWNER, 'updateEvidence', {
      incidentId: incidentA,
      evidenceId: foreign,
      verificationStatus: 'Verified',
    })
    expect(result).toMatchObject({ success: false, code: 'not_found' })
    expect(db.table('evidence').get(foreign)!.data.verificationStatus).toBe('Unverified')
  })

  it('updates only the supplied fields and validates enums', async () => {
    const evidenceId = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    expect(
      await callAs(db, INVESTIGATOR, 'updateEvidence', { incidentId: incidentA, evidenceId, verificationStatus: 'Bogus' }),
    ).toMatchObject({ success: false, code: 'invalid_input' })
    expect(
      await callAs(db, INVESTIGATOR, 'updateEvidence', { incidentId: incidentA, evidenceId, verificationStatus: 'Disputed' }),
    ).toMatchObject({ success: true })
    const data = db.table('evidence').get(evidenceId)!.data
    expect(data.verificationStatus).toBe('Disputed')
    expect(data.title).toBe('p99 latency graph')
  })

  it('denies viewers from updating evidence', async () => {
    const evidenceId = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    expect(
      await callAs(db, VIEWER, 'updateEvidence', { incidentId: incidentA, evidenceId, title: 'Changed' }),
    ).toMatchObject({ success: false, code: 'forbidden' })
  })
})

describe('incident access', () => {
  it('fails closed for incidents still in the Creating state', async () => {
    db.seed('incidents', 'inc-creating', {
      incidentId: 'inc-creating', title: 'x', description: 'x', category: 'x',
      severity: 'Low', status: 'Creating', ownerId: OWNER, initialTimestamp: '2026-11-22T18:00:00.000Z',
    })
    addMember('inc-creating', OWNER, 'Owner')
    expect(await createEvidence(OWNER, 'inc-creating')).toMatchObject({ success: false, code: 'not_found' })
  })

  it('rejects malformed ids before touching storage', async () => {
    expect(await createEvidence(OWNER, '../incidents')).toMatchObject({ success: false, code: 'invalid_input' })
  })
})

describe('timeline', () => {
  it('accepts an evidence reference from the same incident only', async () => {
    const own = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const foreign = idOf(await createEvidence(OUTSIDER, incidentB), 'evidenceId')
    const base = { incidentId: incidentA, title: 'Deploy started', occurredAt: '2026-11-22T17:55:00Z' }

    const ok = await callAs(db, INVESTIGATOR, 'createTimelineEvent', { ...base, sourceEvidenceId: own, important: true })
    const row = db.table('timeline_events').get(idOf(ok, 'timelineEventId'))!
    expect(row.data).toMatchObject({ sourceEvidenceId: own, important: 1, occurredAt: '2026-11-22T17:55:00.000Z' })

    const cross = await callAs(db, INVESTIGATOR, 'createTimelineEvent', { ...base, sourceEvidenceId: foreign })
    expect(cross).toMatchObject({ success: false, code: 'not_found' })
    expect(db.rows('timeline_events')).toHaveLength(1)
  })

  it('rejects invalid timestamps and viewer writes', async () => {
    expect(
      await callAs(db, OWNER, 'createTimelineEvent', { incidentId: incidentA, title: 'x', occurredAt: 'yesterday' }),
    ).toMatchObject({ success: false, code: 'invalid_input' })
    expect(
      await callAs(db, VIEWER, 'createTimelineEvent', { incidentId: incidentA, title: 'x', occurredAt: '2026-11-22T18:00:00Z' }),
    ).toMatchObject({ success: false, code: 'forbidden' })
  })

  it('can clear an evidence reference on update', async () => {
    const own = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const eventId = idOf(
      await callAs(db, OWNER, 'createTimelineEvent', {
        incidentId: incidentA, title: 'x', occurredAt: '2026-11-22T18:00:00Z', sourceEvidenceId: own,
      }),
      'timelineEventId',
    )
    await callAs(db, INVESTIGATOR, 'updateTimelineEvent', { incidentId: incidentA, timelineEventId: eventId, sourceEvidenceId: '' })
    expect(db.table('timeline_events').get(eventId)!.data.sourceEvidenceId).toBe('')
  })
})

describe('hypotheses and evidence links', () => {
  async function hypothesis(userId: string, incidentId: string) {
    return callAs(db, userId, 'createHypothesis', {
      incidentId, title: 'Connection pool exhaustion', explanation: 'Pool max reached during deploy',
    })
  }

  it('creates hypotheses with the default status and denies viewers', async () => {
    const id = idOf(await hypothesis(INVESTIGATOR, incidentA), 'hypothesisId')
    expect(db.table('hypotheses').get(id)!.data.status).toBe('Proposed')
    expect(await hypothesis(VIEWER, incidentA)).toMatchObject({ success: false, code: 'forbidden' })
  })

  it('upserts one relationship per evidence/hypothesis pair', async () => {
    const evidenceId = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const hypothesisId = idOf(await hypothesis(OWNER, incidentA), 'hypothesisId')
    const link = { incidentId: incidentA, evidenceId, hypothesisId }

    expect(await callAs(db, INVESTIGATOR, 'setEvidenceLink', { ...link, relationship: 'Supports' })).toMatchObject({ success: true })
    expect(await callAs(db, INVESTIGATOR, 'setEvidenceLink', { ...link, relationship: 'Contradicts' })).toMatchObject({ success: true })
    expect(db.rows('evidence_links')).toHaveLength(1)
    expect(db.rows('evidence_links')[0].data).toEqual({ ...link, relationship: 'Contradicts' })

    expect(await callAs(db, VIEWER, 'removeEvidenceLink', link)).toMatchObject({ success: false, code: 'forbidden' })
    expect(await callAs(db, INVESTIGATOR, 'removeEvidenceLink', link)).toMatchObject({ success: true })
    expect(db.rows('evidence_links')).toHaveLength(0)
  })

  it('refuses links whose evidence or hypothesis belongs to another incident', async () => {
    const ownEvidence = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const ownHypothesis = idOf(await hypothesis(OWNER, incidentA), 'hypothesisId')
    const foreignEvidence = idOf(await createEvidence(OUTSIDER, incidentB), 'evidenceId')
    const foreignHypothesis = idOf(await hypothesis(OUTSIDER, incidentB), 'hypothesisId')

    for (const [evidenceId, hypothesisId] of [
      [foreignEvidence, ownHypothesis],
      [ownEvidence, foreignHypothesis],
    ]) {
      const result = await callAs(db, OWNER, 'setEvidenceLink', {
        incidentId: incidentA, evidenceId, hypothesisId, relationship: 'Supports',
      })
      expect(result).toMatchObject({ success: false, code: 'not_found' })
    }
    expect(db.rows('evidence_links')).toHaveLength(0)
  })

  it('rejects unknown relationship values', async () => {
    const evidenceId = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const hypothesisId = idOf(await hypothesis(OWNER, incidentA), 'hypothesisId')
    expect(
      await callAs(db, OWNER, 'setEvidenceLink', { incidentId: incidentA, evidenceId, hypothesisId, relationship: 'Proves' }),
    ).toMatchObject({ success: false, code: 'invalid_input' })
  })
})

describe('closed incidents', () => {
  async function close() {
    const result = await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Closed' })
    expect(result).toMatchObject({ success: true })
  }

  it('are read-only for every member, Owner included', async () => {
    const evidenceId = idOf(await createEvidence(OWNER, incidentA), 'evidenceId')
    const hypothesisId = idOf(
      await callAs(db, OWNER, 'createHypothesis', { incidentId: incidentA, title: 'h', explanation: 'e' }),
      'hypothesisId',
    )
    await close()

    for (const user of [OWNER, INVESTIGATOR]) {
      expect(await createEvidence(user, incidentA)).toMatchObject({ success: false, code: 'incident_closed' })
      expect(await callAs(db, user, 'updateEvidence', { incidentId: incidentA, evidenceId, title: 'changed' }))
        .toMatchObject({ success: false, code: 'incident_closed' })
      expect(await callAs(db, user, 'createTimelineEvent', {
        incidentId: incidentA, title: 'x', occurredAt: '2026-11-22T18:00:00Z',
      })).toMatchObject({ success: false, code: 'incident_closed' })
      expect(await callAs(db, user, 'updateHypothesis', { incidentId: incidentA, hypothesisId, status: 'Supported' }))
        .toMatchObject({ success: false, code: 'incident_closed' })
      expect(await callAs(db, user, 'setEvidenceLink', {
        incidentId: incidentA, evidenceId, hypothesisId, relationship: 'Supports',
      })).toMatchObject({ success: false, code: 'incident_closed' })
    }
    // Viewers are still refused on role grounds first.
    expect(await createEvidence(VIEWER, incidentA)).toMatchObject({ success: false, code: 'forbidden' })
    expect(db.table('evidence').get(evidenceId)!.data.title).toBe('p99 latency graph')
  })

  it('accept only a status-only reopen, and only from the Owner', async () => {
    await close()
    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, title: 'Renamed' }))
      .toMatchObject({ success: false, code: 'incident_closed' })
    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Open', title: 'Renamed' }))
      .toMatchObject({ success: false, code: 'incident_closed' })
    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Closed' }))
      .toMatchObject({ success: false, code: 'incident_closed' })
    expect(await callAs(db, INVESTIGATOR, 'updateIncident', { incidentId: incidentA, status: 'Open' }))
      .toMatchObject({ success: false, code: 'forbidden' })
    expect(db.table('incidents').get(incidentA)!.data).toMatchObject({ status: 'Closed', title: 'Incident A' })

    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Investigating' }))
      .toMatchObject({ success: true })
    expect(await createEvidence(INVESTIGATOR, incidentA)).toMatchObject({ success: true })
  })

  it('still allow the Owner to revoke access', async () => {
    await close()
    expect(await callAs(db, OWNER, 'updateIncidentMember', { incidentId: incidentA, userId: VIEWER, status: 'removed' }))
      .toMatchObject({ success: true })
    expect(await callAs(db, VIEWER, 'listIncidentMembers', { incidentId: incidentA }))
      .toMatchObject({ success: false, code: 'not_found' })
  })
})

describe('incident administration', () => {
  it('restricts incident updates to the owner', async () => {
    expect(await callAs(db, INVESTIGATOR, 'updateIncident', { incidentId: incidentA, status: 'Closed' }))
      .toMatchObject({ success: false, code: 'forbidden' })
    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Creating' }))
      .toMatchObject({ success: false, code: 'invalid_input' })
    expect(await callAs(db, OWNER, 'updateIncident', { incidentId: incidentA, status: 'Investigating', ownerId: OUTSIDER }))
      .toMatchObject({ success: true })
    const data = db.table('incidents').get(incidentA)!.data
    expect(data.status).toBe('Investigating')
    expect(data.ownerId).toBe(OWNER)
  })

  it('lets the owner add, change and remove members by email', async () => {
    const added = await callAs(db, OWNER, 'addIncidentMember', {
      incidentId: incidentA, email: 'Outsider@Example.test', role: 'Viewer',
    })
    expect(added).toMatchObject({ success: true, data: { userId: OUTSIDER, role: 'Viewer' } })
    expect(await createEvidence(OUTSIDER, incidentA)).toMatchObject({ success: false, code: 'forbidden' })

    await callAs(db, OWNER, 'updateIncidentMember', { incidentId: incidentA, userId: OUTSIDER, role: 'Investigator' })
    expect(await createEvidence(OUTSIDER, incidentA)).toMatchObject({ success: true })

    await callAs(db, OWNER, 'updateIncidentMember', { incidentId: incidentA, userId: OUTSIDER, status: 'removed' })
    expect(await createEvidence(OUTSIDER, incidentA)).toMatchObject({ success: false, code: 'not_found' })
  })

  it('restores a removed member instead of duplicating the row', async () => {
    const result = await callAs(db, OWNER, 'addIncidentMember', {
      incidentId: incidentA, email: 'removed@example.test', role: 'Viewer',
    })
    expect(result).toMatchObject({ success: true })
    const rows = db.rows('team_members').filter((row) => row.data.userId === REMOVED)
    expect(rows).toHaveLength(1)
    expect(rows[0].data).toMatchObject({ status: 'active', role: 'Viewer' })
  })

  it('refuses non-owners, Owner grants, and changes to the owner row', async () => {
    expect(await callAs(db, INVESTIGATOR, 'addIncidentMember', { incidentId: incidentA, email: 'outsider@example.test', role: 'Viewer' }))
      .toMatchObject({ success: false, code: 'forbidden' })
    expect(await callAs(db, OWNER, 'addIncidentMember', { incidentId: incidentA, email: 'outsider@example.test', role: 'Owner' }))
      .toMatchObject({ success: false, code: 'invalid_input' })
    expect(await callAs(db, OWNER, 'updateIncidentMember', { incidentId: incidentA, userId: OWNER, status: 'removed' }))
      .toMatchObject({ success: false, code: 'forbidden' })
    expect(await callAs(db, INVESTIGATOR, 'updateIncidentMember', { incidentId: incidentA, userId: VIEWER, role: 'Investigator' }))
      .toMatchObject({ success: false, code: 'forbidden' })
    expect(await callAs(db, OWNER, 'addIncidentMember', { incidentId: incidentA, email: 'nobody@example.test', role: 'Viewer' }))
      .toMatchObject({ success: false, code: 'invalid_input' })
  })

  it('cannot manage members of an incident the caller does not own', async () => {
    expect(await callAs(db, OWNER, 'addIncidentMember', { incidentId: incidentB, email: 'viewer@example.test', role: 'Investigator' }))
      .toMatchObject({ success: false, code: 'not_found' })
  })

  it('lists active members to members, with emails only for the owner', async () => {
    const asViewer = await callAs(db, VIEWER, 'listIncidentMembers', { incidentId: incidentA })
    if (!asViewer.success) throw new Error(asViewer.error)
    const viewerList = (asViewer.data as { members: Array<Record<string, unknown>> }).members
    expect(viewerList.map((m) => m.userId).sort()).toEqual([INVESTIGATOR, OWNER, VIEWER].sort())
    expect(viewerList.every((m) => m.email === undefined)).toBe(true)

    const asOwner = await callAs(db, OWNER, 'listIncidentMembers', { incidentId: incidentA })
    if (!asOwner.success) throw new Error(asOwner.error)
    const ownerList = (asOwner.data as { members: Array<Record<string, unknown>> }).members
    expect(ownerList).toHaveLength(4)
    expect(ownerList.find((m) => m.userId === REMOVED)).toMatchObject({ status: 'removed', email: 'removed@example.test' })

    expect(await callAs(db, OUTSIDER, 'listIncidentMembers', { incidentId: incidentA }))
      .toMatchObject({ success: false, code: 'not_found' })
  })
})
