/**
 * AI analyst contract (spec §9): structured context in, structured findings
 * out, and every evidence citation validated against the CURRENT incident's
 * real evidence ids before anything is shown. Pure — no I/O — so the
 * guarantees are unit-tested.
 */

import type {
  EvidenceData,
  EvidenceLinkData,
  HypothesisData,
  IncidentData,
  TimelineEventData,
} from './incident-model'

export interface CitedStatement {
  statement: string
  evidenceIds: string[]
}

export interface EvidenceAssessment {
  evidenceId: string
  explanation: string
}

export interface SuggestedHypothesis {
  title: string
  rationale: string
  evidenceIds: string[]
}

/** The validated response shown to users. */
export interface IncidentAnalysis {
  summary: string
  /** What the evidence establishes — every entry cites ≥1 real evidence id. */
  establishedFacts: CitedStatement[]
  /** What the evidence suggests — suggestions only, never conclusions. */
  hypotheses: SuggestedHypothesis[]
  supportingEvidence: EvidenceAssessment[]
  contradictingEvidence: EvidenceAssessment[]
  /** What remains unknown. */
  missingInformation: string[]
  recommendedActions: string[]
  uncertainty: string
  /** Citations the model produced that do not exist in this incident. */
  rejectedReferences: string[]
}

export interface AnalysisContext {
  incident: Pick<IncidentData, 'title' | 'description' | 'category' | 'severity' | 'status' | 'initialTimestamp'>
  evidence: Array<{ id: string } & Pick<EvidenceData, 'title' | 'description' | 'type' | 'source' | 'verificationStatus'>>
  timeline: Array<{ id: string } & Pick<TimelineEventData, 'title' | 'description' | 'occurredAt' | 'sourceEvidenceId'> & { important: boolean }>
  hypotheses: Array<{ id: string } & Pick<HypothesisData, 'title' | 'explanation' | 'status'>>
  relationships: Array<Pick<EvidenceLinkData, 'evidenceId' | 'hypothesisId' | 'relationship'>>
}

const MAX_TEXT = 2000
const MAX_ITEMS = 12

export function buildAnalysisContext(input: {
  incident: IncidentData
  evidence: Array<{ recordId: string; data: EvidenceData }>
  timeline: Array<{ recordId: string; data: TimelineEventData }>
  hypotheses: Array<{ recordId: string; data: HypothesisData }>
  links: Array<{ data: EvidenceLinkData }>
}): AnalysisContext {
  const { incident } = input
  return {
    incident: {
      title: incident.title,
      description: incident.description,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      initialTimestamp: incident.initialTimestamp,
    },
    evidence: input.evidence.map(({ recordId, data }) => ({
      id: recordId,
      title: data.title,
      description: data.description,
      type: data.type,
      source: data.source ?? '',
      verificationStatus: data.verificationStatus,
    })),
    timeline: [...input.timeline]
      .sort((a, b) => Date.parse(a.data.occurredAt) - Date.parse(b.data.occurredAt))
      .map(({ recordId, data }) => ({
        id: recordId,
        title: data.title,
        description: data.description ?? '',
        occurredAt: data.occurredAt,
        sourceEvidenceId: data.sourceEvidenceId ?? '',
        important: Boolean(data.important),
      })),
    hypotheses: input.hypotheses.map(({ recordId, data }) => ({
      id: recordId,
      title: data.title,
      explanation: data.explanation,
      status: data.status,
    })),
    relationships: input.links.map(({ data }) => ({
      evidenceId: data.evidenceId,
      hypothesisId: data.hypothesisId,
      relationship: data.relationship,
    })),
  }
}

export const ANALYST_SYSTEM_PROMPT = `You are SignalRoom's incident investigation analyst.
You receive ONE incident's structured records as JSON. Use ONLY that data.

Rules:
- Never invent evidence, evidence ids, timestamps, people, or events.
- Cite evidence ONLY by the exact "id" values from the provided "evidence" array.
- "establishedFacts" are statements directly established by cited evidence (prefer Verified evidence). Every fact MUST cite at least one evidence id.
- "hypotheses" are possible explanations (suggestions only; humans decide).
- Put anything not covered by the data in "missingInformation".
- State your confidence and its limits in "uncertainty".

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "summary": string,
  "establishedFacts": [{ "statement": string, "evidenceIds": string[] }],
  "hypotheses": [{ "title": string, "rationale": string, "evidenceIds": string[] }],
  "supportingEvidence": [{ "evidenceId": string, "explanation": string }],
  "contradictingEvidence": [{ "evidenceId": string, "explanation": string }],
  "missingInformation": string[],
  "recommendedActions": string[],
  "uncertainty": string
}`

export function buildAnalystPrompt(context: AnalysisContext, question: string): string {
  return [
    'Incident records (JSON):',
    JSON.stringify(context, null, 2),
    '',
    `Investigator request: ${question || 'Summarize the investigation and recommend next steps.'}`,
  ].join('\n')
}

/** Extracts the first top-level JSON object from model text (tolerates code fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The AI response did not contain a JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

function str(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => str(item)).filter(Boolean).slice(0, MAX_ITEMS)
    : []
}

function objects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').slice(0, MAX_ITEMS)
    : []
}

/**
 * Normalizes a raw model response and validates every evidence reference
 * against `validEvidenceIds` (the current incident's evidence only).
 * Invalid ids are removed and reported; a fact left with no valid citation is
 * not an established fact, so it is dropped.
 */
export function validateAnalysis(raw: unknown, validEvidenceIds: ReadonlySet<string>): IncidentAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('The AI response was not an object')
  const input = raw as Record<string, unknown>
  const rejected = new Set<string>()

  const keep = (ids: unknown): string[] => {
    const out: string[] = []
    for (const id of strings(ids)) {
      if (validEvidenceIds.has(id)) {
        if (!out.includes(id)) out.push(id)
      } else {
        rejected.add(id)
      }
    }
    return out
  }

  const assessments = (value: unknown): EvidenceAssessment[] =>
    objects(value).flatMap((item) => {
      const evidenceId = str(item.evidenceId)
      if (!validEvidenceIds.has(evidenceId)) {
        if (evidenceId) rejected.add(evidenceId)
        return []
      }
      return [{ evidenceId, explanation: str(item.explanation) }]
    })

  const establishedFacts = objects(input.establishedFacts)
    .map((item) => ({ statement: str(item.statement), evidenceIds: keep(item.evidenceIds) }))
    .filter((fact) => fact.statement && fact.evidenceIds.length > 0)

  const hypotheses = objects(input.hypotheses)
    .map((item) => ({ title: str(item.title, 200), rationale: str(item.rationale), evidenceIds: keep(item.evidenceIds) }))
    .filter((hypothesis) => hypothesis.title)

  return {
    summary: str(input.summary),
    establishedFacts,
    hypotheses,
    supportingEvidence: assessments(input.supportingEvidence),
    contradictingEvidence: assessments(input.contradictingEvidence),
    missingInformation: strings(input.missingInformation),
    recommendedActions: strings(input.recommendedActions),
    uncertainty: str(input.uncertainty),
    rejectedReferences: [...rejected],
  }
}
