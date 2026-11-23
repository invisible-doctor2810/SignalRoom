import { beforeEach, describe, expect, it } from 'vitest'
import { validateAnalysis } from '../domain/ai-analysis'
import { createAnalystActions, type AnalystModel } from './analyst'
import { callAs, fakeTools, FakeDb } from './test-support'
import type { Env } from '../../worker'

const OWNER = 'owner'
const VIEWER = 'viewer'
const OUTSIDER = 'outsider'

let db: FakeDb
let incidentA: string
let incidentB: string
let evidenceA: string
let evidenceB: string

function id(result: Awaited<ReturnType<typeof callAs>>, key: string) {
  if (!result.success) throw new Error(result.error)
  return (result.data as Record<string, string>)[key]
}

async function run(model: AnalystModel, userId: string, params: Record<string, unknown>) {
  const handler = createAnalystActions(model).analyzeIncident
  return handler({ userId, params, tools: fakeTools(db, userId), env: {} as Env, callerJwt: 'jwt' })
}

beforeEach(async () => {
  db = new FakeDb()
  const incident = (owner: string, title: string) => callAs(db, owner, 'createIncident', {
    title, description: `${title} description`, category: 'c', severity: 'High',
    initialTimestamp: '2026-11-22T18:00:00.000Z',
  })
  incidentA = id(await incident(OWNER, 'Checkout outage'), 'incidentId')
  incidentB = id(await incident(OUTSIDER, 'Secret other incident'), 'incidentId')
  db.seed('team_members', `${incidentA}:${VIEWER}`, { teamId: incidentA, userId: VIEWER, role: 'Viewer', status: 'active' })
  evidenceA = id(await callAs(db, OWNER, 'createEvidence', {
    incidentId: incidentA, title: 'Pool graph', description: 'Pool at 100%', type: 'Metric', verificationStatus: 'Verified',
  }), 'evidenceId')
  evidenceB = id(await callAs(db, OUTSIDER, 'createEvidence', {
    incidentId: incidentB, title: 'Other secret evidence', description: 'classified', type: 'Log',
  }), 'evidenceId')
})

const answer = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  summary: 'Checkout failed because the DB pool saturated.',
  establishedFacts: [{ statement: 'Pool hit 100%', evidenceIds: [evidenceA] }],
  hypotheses: [{ title: 'Pool exhaustion', rationale: 'Pool maxed', evidenceIds: [evidenceA] }],
  supportingEvidence: [{ evidenceId: evidenceA, explanation: 'Shows saturation' }],
  contradictingEvidence: [],
  missingInformation: ['Deploy diff'],
  recommendedActions: ['Check pool config'],
  uncertainty: 'Medium',
  ...overrides,
})

describe('AI analyst', () => {
  it('sends only the current incident’s records to the model', async () => {
    let prompt = ''
    const result = await run(async (input) => { prompt = input.prompt; return answer() }, VIEWER, { incidentId: incidentA })
    expect(result).toMatchObject({ success: true })
    expect(prompt).toContain(evidenceA)
    expect(prompt).toContain('Checkout outage')
    expect(prompt).not.toContain(evidenceB)
    expect(prompt).not.toContain('Secret other incident')
    expect(prompt).not.toContain('classified')
  })

  it('rejects invented and cross-incident evidence references', async () => {
    const result = await run(async () => answer({
      establishedFacts: [
        { statement: 'Real fact', evidenceIds: [evidenceA, 'ev-invented'] },
        { statement: 'Fact citing only fake/foreign evidence', evidenceIds: ['ev-invented', evidenceB] },
      ],
      supportingEvidence: [{ evidenceId: evidenceB, explanation: 'foreign' }, { evidenceId: evidenceA, explanation: 'ok' }],
      contradictingEvidence: [{ evidenceId: 'ev-made-up', explanation: 'x' }],
    }), OWNER, { incidentId: incidentA })
    if (!result.success) throw new Error(result.error)
    const { analysis } = result.data as { analysis: ReturnType<typeof validateAnalysis> }
    expect(analysis.establishedFacts).toEqual([{ statement: 'Real fact', evidenceIds: [evidenceA] }])
    expect(analysis.supportingEvidence).toEqual([{ evidenceId: evidenceA, explanation: 'ok' }])
    expect(analysis.contradictingEvidence).toEqual([])
    expect(analysis.rejectedReferences.sort()).toEqual(['ev-invented', 'ev-made-up', evidenceB].sort())
  })

  it('denies non-members without calling the model', async () => {
    let called = false
    const result = await run(async () => { called = true; return answer() }, OUTSIDER, { incidentId: incidentA })
    expect(result).toMatchObject({ success: false, code: 'not_found' })
    expect(called).toBe(false)
  })

  it('handles model failures and unreadable output as errors', async () => {
    expect(await run(async () => { throw new Error('upstream 500') }, OWNER, { incidentId: incidentA }))
      .toMatchObject({ success: false, code: 'ai_unavailable' })
    expect(await run(async () => { throw Object.assign(new Error('Payment Required'), { statusCode: 402 }) }, OWNER, { incidentId: incidentA }))
      .toMatchObject({ success: false, code: 'ai_payment_required' })
    expect(await run(async () => 'I think it was the database.', OWNER, { incidentId: incidentA }))
      .toMatchObject({ success: false, code: 'ai_invalid_response' })
  })

  it('accepts fenced JSON and keeps facts separate from suggestions', async () => {
    const result = await run(async () => '```json\n' + answer() + '\n```', OWNER, { incidentId: incidentA, question: 'What happened?' })
    if (!result.success) throw new Error(result.error)
    const { analysis } = result.data as { analysis: ReturnType<typeof validateAnalysis> }
    expect(analysis.establishedFacts).toHaveLength(1)
    expect(analysis.hypotheses[0]).toMatchObject({ title: 'Pool exhaustion' })
    expect(analysis.missingInformation).toEqual(['Deploy diff'])
    expect(analysis.rejectedReferences).toEqual([])
  })

  it('never writes records', async () => {
    // Snapshot every stored row (reads create empty tables in the fake; ignore those).
    const snapshot = () => JSON.stringify(
      [...db.collections.entries()].filter(([, rows]) => rows.size > 0).map(([name, rows]) => [name, [...rows.entries()]]),
    )
    const before = snapshot()
    await run(async () => answer(), OWNER, { incidentId: incidentA })
    expect(snapshot()).toBe(before)
  })
})
