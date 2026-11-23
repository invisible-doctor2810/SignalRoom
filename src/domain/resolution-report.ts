/**
 * Resolution report (spec §10), generated deterministically from persisted,
 * human-reviewed records — never from unreviewed AI output. Confirmed
 * findings come only from Verified evidence and Supported hypotheses;
 * everything else is listed as unresolved.
 */

import type {
  EvidenceData,
  EvidenceLinkData,
  HypothesisData,
  IncidentData,
  IncidentRole,
  TimelineEventData,
} from './incident-model'

interface Rec<T> {
  recordId: string
  data: T
  createdBy: string
}

export interface ReportInput {
  incident: IncidentData
  evidence: Array<Rec<EvidenceData>>
  timeline: Array<Rec<TimelineEventData>>
  hypotheses: Array<Rec<HypothesisData>>
  links: Array<{ data: EvidenceLinkData }>
  members: Array<{ name: string; role: IncidentRole }>
  userName: (userId: string) => string
  generatedAt: Date
  generatedBy: string
}

/** User-entered text is literal: escape Markdown syntax so titles like `__x__` render as typed. */
export const md = (value: string) => value.replace(/([\\`*_{}[\]<>()#+\-!|~])/g, '\\$1').replace(/\r?\n/g, ' ')
const cell = md
const time = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'unknown time' : date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function buildResolutionReport(input: ReportInput): string {
  const { incident, evidence, hypotheses, links } = input
  const byId = new Map(evidence.map((item) => [item.recordId, item]))
  const timeline = [...input.timeline].sort((a, b) => Date.parse(a.data.occurredAt) - Date.parse(b.data.occurredAt))
  const verified = evidence.filter((item) => item.data.verificationStatus === 'Verified')
  const disputed = evidence.filter((item) => item.data.verificationStatus === 'Disputed')
  const unverified = evidence.filter((item) => item.data.verificationStatus === 'Unverified')
  const supported = hypotheses.filter((item) => item.data.status === 'Supported')
  const rejected = hypotheses.filter((item) => item.data.status === 'Rejected')
  const open = hypotheses.filter((item) => !['Supported', 'Rejected'].includes(item.data.status))
  const linked = (hypothesisId: string, relationship: EvidenceLinkData['relationship']) =>
    links
      .filter((link) => link.data.hypothesisId === hypothesisId && link.data.relationship === relationship)
      .map((link) => byId.get(link.data.evidenceId))
      .filter((item): item is Rec<EvidenceData> => Boolean(item))
  const titles = (items: Array<Rec<EvidenceData>>) =>
    items.length ? items.map((item) => `${md(item.data.title)} (${item.data.verificationStatus})`).join('; ') : 'none'

  const lines: string[] = []
  const push = (...more: string[]) => lines.push(...more)

  push(`# Resolution report: ${md(incident.title)}`, '')
  push(`_Generated ${time(input.generatedAt.toISOString())} by ${md(input.generatedBy)} from the incident's persisted records. AI suggestions are not included unless investigators recorded them as evidence or hypotheses._`, '')

  push('## 1. Incident overview', '')
  push(`- **Title:** ${md(incident.title)}`)
  push(`- **Category:** ${md(incident.category)}`)
  push(`- **Severity:** ${incident.severity}`)
  push(`- **Status:** ${incident.status}`)
  push(`- **Incident time:** ${time(incident.initialTimestamp)}`)
  push(`- **Owner:** ${md(input.userName(incident.ownerId))}`)
  push(`- **Description:** ${md(incident.description)}`, '')

  push('## 2. Executive summary', '')
  push(
    `The incident is **${incident.status}**. Investigators recorded ${evidence.length} evidence item(s) ` +
      `(${verified.length} verified, ${disputed.length} disputed, ${unverified.length} unverified), ` +
      `${timeline.length} timeline event(s) and ${hypotheses.length} hypothesis(es) ` +
      `(${supported.length} supported, ${rejected.length} rejected, ${open.length} still open).`,
  )
  push(
    supported.length
      ? `Leading explanation: **${supported.map((item) => md(item.data.title)).join('; ')}**.`
      : 'No hypothesis has been marked Supported yet, so the root cause is not established.',
    '',
  )

  push('## 3. Verified incident timeline', '')
  if (timeline.length === 0) push('No timeline events were recorded.')
  for (const event of timeline) {
    const source = event.data.sourceEvidenceId ? byId.get(event.data.sourceEvidenceId) : undefined
    const basis = source
      ? source.data.verificationStatus === 'Verified'
        ? `verified by evidence “${md(source.data.title)}”`
        : `based on ${source.data.verificationStatus.toLowerCase()} evidence “${md(source.data.title)}”`
      : 'no linked evidence (unverified)'
    push(`- **${time(event.data.occurredAt)}** — ${md(event.data.title)}${event.data.important ? ' ⚑' : ''} _(${basis}; recorded by ${md(input.userName(event.createdBy))})_`)
    if (event.data.description) push(`  ${md(event.data.description)}`)
  }
  push('')

  push('## 4. Evidence reviewed', '')
  if (evidence.length === 0) push('No evidence was recorded.')
  else {
    push('| Evidence | Type | Source | Status | Added by |', '|---|---|---|---|---|')
    for (const item of evidence) {
      push(`| ${cell(item.data.title)} | ${item.data.type} | ${cell(item.data.source || '—')} | ${item.data.verificationStatus} | ${cell(input.userName(item.createdBy))} |`)
    }
  }
  push('')

  push('## 5. Hypotheses evaluated', '')
  if (hypotheses.length === 0) push('No hypotheses were recorded.')
  for (const item of hypotheses) {
    push(`### ${md(item.data.title)} — ${item.data.status}`, '', md(item.data.explanation), '')
    push(`- Supporting evidence: ${titles(linked(item.recordId, 'Supports'))}`)
    push(`- Contradicting evidence: ${titles(linked(item.recordId, 'Contradicts'))}`)
    push(`- Neutral evidence: ${titles(linked(item.recordId, 'Neutral'))}`, '')
  }

  push('## 6. Established findings', '')
  push('_Only Verified evidence and hypotheses marked Supported by investigators._', '')
  if (verified.length === 0 && supported.length === 0) push('No findings have been confirmed yet.')
  for (const item of verified) push(`- Verified: ${md(item.data.title)} — ${md(item.data.description)}`)
  for (const item of supported) {
    const backing = linked(item.recordId, 'Supports').filter((ev) => ev.data.verificationStatus === 'Verified')
    push(`- Supported explanation: **${md(item.data.title)}** (verified supporting evidence: ${titles(backing)})`)
  }
  push('')

  push('## 7. Unresolved questions', '')
  const unresolved = [
    ...open.map((item) => `Hypothesis “${md(item.data.title)}” is ${item.data.status}.`),
    ...disputed.map((item) => `Evidence “${md(item.data.title)}” is disputed.`),
    ...unverified.map((item) => `Evidence “${md(item.data.title)}” is not yet verified.`),
  ]
  if (unresolved.length === 0) push('None recorded.')
  for (const line of unresolved) push(`- ${line}`)
  push('')

  push('## 8. Final resolution', '')
  const finished = incident.status === 'Resolved' || incident.status === 'Closed'
  if (finished && supported.length) push(`${incident.status}. Root cause determined by investigators: **${supported.map((item) => md(item.data.title)).join('; ')}**.`)
  else if (finished) push(`${incident.status}, but no hypothesis was marked Supported — the root cause remains unconfirmed.`)
  else push(`Not yet resolved (status: ${incident.status}).`)
  push('')

  push('## 9. Investigator information', '')
  if (input.members.length === 0) push('Team membership unavailable.')
  for (const member of input.members) push(`- ${md(member.name)} — ${member.role}`)
  push('')

  return lines.join('\n')
}
