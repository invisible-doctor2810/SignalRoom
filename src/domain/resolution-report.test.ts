import { describe, expect, it } from 'vitest'
import { buildResolutionReport, type ReportInput } from './resolution-report'

const base: ReportInput = {
  incident: {
    incidentId: 'inc', title: 'Checkout outage', description: '503s at checkout', category: 'Payments',
    severity: 'High', status: 'Resolved', ownerId: 'u-owner', initialTimestamp: '2026-11-22T18:00:00.000Z',
  },
  evidence: [
    { recordId: 'e1', createdBy: 'u-inv', data: { incidentId: 'inc', title: 'Pool graph', description: 'Pool 100%', type: 'Metric', source: 'Grafana', verificationStatus: 'Verified' } },
    { recordId: 'e2', createdBy: 'u-inv', data: { incidentId: 'inc', title: 'Rumor', description: 'Someone said DNS', type: 'Message', source: '', verificationStatus: 'Disputed' } },
  ],
  timeline: [
    { recordId: 't2', createdBy: 'u-owner', data: { incidentId: 'inc', title: 'Rollback', description: '', occurredAt: '2026-11-22T18:30:00Z', sourceEvidenceId: '', important: 0 } },
    { recordId: 't1', createdBy: 'u-owner', data: { incidentId: 'inc', title: 'Pool saturated', description: '', occurredAt: '2026-11-22T18:02:00Z', sourceEvidenceId: 'e1', important: 1 } },
  ],
  hypotheses: [
    { recordId: 'h1', createdBy: 'u-inv', data: { incidentId: 'inc', title: 'Pool exhaustion', explanation: 'Too many conns', status: 'Supported' } },
    { recordId: 'h2', createdBy: 'u-inv', data: { incidentId: 'inc', title: 'DNS failure', explanation: 'Resolver down', status: 'Under Investigation' } },
  ],
  links: [
    { data: { incidentId: 'inc', evidenceId: 'e1', hypothesisId: 'h1', relationship: 'Supports' } },
    { data: { incidentId: 'inc', evidenceId: 'e2', hypothesisId: 'h2', relationship: 'Supports' } },
  ],
  members: [{ name: 'Olive Owner', role: 'Owner' }, { name: 'Ivan Investigator', role: 'Investigator' }],
  userName: (id) => ({ 'u-owner': 'Olive Owner', 'u-inv': 'Ivan Investigator' })[id] ?? 'Unknown user',
  generatedAt: new Date('2026-11-23T10:00:00Z'),
  generatedBy: 'Olive Owner',
}

describe('resolution report', () => {
  const report = buildResolutionReport(base)

  it('contains all nine required sections in order', () => {
    const headings = [...report.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`)
    expect(headings).toEqual([
      '1. Incident overview', '2. Executive summary', '3. Verified incident timeline', '4. Evidence reviewed',
      '5. Hypotheses evaluated', '6. Established findings', '7. Unresolved questions', '8. Final resolution',
      '9. Investigator information',
    ])
  })

  it('separates confirmed findings from unresolved explanations', () => {
    const findings = report.split('## 6.')[1].split('## 7.')[0]
    const unresolved = report.split('## 7.')[1].split('## 8.')[0]
    expect(findings).toContain('Pool graph')
    expect(findings).toContain('Pool exhaustion')
    expect(findings).not.toContain('DNS failure')
    expect(findings).not.toContain('Rumor')
    expect(unresolved).toContain('DNS failure')
    expect(unresolved).toContain('“Rumor” is disputed')
    expect(report.split('## 8.')[1]).toContain('Root cause determined by investigators: **Pool exhaustion**')
  })

  it('orders the timeline chronologically and marks evidence basis', () => {
    const timeline = report.split('## 3.')[1].split('## 4.')[0]
    expect(timeline.indexOf('Pool saturated')).toBeLessThan(timeline.indexOf('Rollback'))
    expect(timeline).toContain('verified by evidence “Pool graph”')
    expect(timeline).toContain('no linked evidence (unverified)')
  })

  it('does not claim a root cause when nothing is supported', () => {
    const open = buildResolutionReport({
      ...base,
      incident: { ...base.incident, status: 'Investigating' },
      hypotheses: base.hypotheses.map((h) => ({ ...h, data: { ...h.data, status: 'Proposed' as const } })),
    })
    expect(open).toContain('root cause is not established')
    expect(open).toContain('Not yet resolved (status: Investigating)')
  })

  it('treats user text as literal, escaping Markdown syntax', () => {
    const tricky = buildResolutionReport({
      ...base,
      incident: { ...base.incident, title: '__test-1__ *prod* [db]' },
    })
    expect(tricky).toContain('# Resolution report: \\_\\_test\\-1\\_\\_ \\*prod\\* \\[db\\]')
  })

  it('lists investigators and escapes table cells', () => {
    const piped = buildResolutionReport({
      ...base,
      evidence: [{ ...base.evidence[0], data: { ...base.evidence[0].data, title: 'a | b' } }],
    })
    expect(piped).toContain('a \\| b')
    expect(report).toContain('- Ivan Investigator — Investigator')
  })
})
