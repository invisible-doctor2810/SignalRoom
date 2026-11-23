import { generateText } from 'ai'
import { createDeepSpaceAI, DEEPSPACE_AI_DEFAULTS } from 'deepspace/worker'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  ANALYST_SYSTEM_PROMPT,
  buildAnalysisContext,
  buildAnalystPrompt,
  extractJsonObject,
  validateAnalysis,
} from '../domain/ai-analysis'
import type {
  EvidenceData,
  EvidenceLinkData,
  HypothesisData,
  TimelineEventData,
} from '../domain/incident-model'
import { optionalText, recordId } from '../domain/validation'
import { requireIncidentAccess } from '../server/incident-access'
import { action, type Params } from './shared'

async function loadAll<T>(tools: ActionTools, collection: string, incidentId: string) {
  const result = await tools.query<Record<string, unknown>>(collection, { where: { incidentId }, limit: 200 })
  if (!result.success) throw new Error(`Failed to load ${collection}`)
  // Defense in depth: keep only rows that really belong to this incident.
  return result.data.records
    .filter((record) => record.data.incidentId === incidentId)
    .map((record) => ({ recordId: record.recordId, data: record.data as unknown as T }))
}

/** Generates text from the model; replaceable in unit tests. */
export type AnalystModel = (input: { system: string; prompt: string; env: Env; callerJwt: string }) => Promise<string>

export const deepSpaceAnalystModel: AnalystModel = async ({ system, prompt, env, callerJwt }) => {
  // DeepSpace-native AI proxy; billed to the calling user's JWT.
  const model = createDeepSpaceAI(env, 'anthropic', { authToken: callerJwt })(DEEPSPACE_AI_DEFAULTS.directGeneration)
  const { text } = await generateText({ model, system, prompt })
  return text
}

export function createAnalystActions(model: AnalystModel): Record<string, ActionHandler<Env>> {
  return {
    /**
     * Read-only analysis of ONE incident. Any active member may ask (spec:
     * Viewers may read AI results). The model never writes records; its
     * output is validated and returned as suggestions for human review.
     */
    analyzeIncident: action('analyzeIncident', async ({ userId, params, tools, env, callerJwt }) => {
      const input = params as Params
      const incidentId = recordId(input.incidentId, 'Incident')
      const question = optionalText(input.question, 'Question', 1000)
      const access = await requireIncidentAccess(tools, userId, incidentId, 'incident.read')

      const [evidence, timeline, hypotheses, links] = await Promise.all([
        loadAll<EvidenceData>(tools, 'evidence', incidentId),
        loadAll<TimelineEventData>(tools, 'timeline_events', incidentId),
        loadAll<HypothesisData>(tools, 'hypotheses', incidentId),
        loadAll<EvidenceLinkData>(tools, 'evidence_links', incidentId),
      ])
      const context = buildAnalysisContext({ incident: access.incident, evidence, timeline, hypotheses, links })

      let text: string
      try {
        text = await model({ system: ANALYST_SYSTEM_PROMPT, prompt: buildAnalystPrompt(context, question), env, callerJwt })
      } catch (error) {
        console.error('[analyst] model call failed', error)
        const status = (error as { statusCode?: unknown } | null)?.statusCode
        if (status === 402) {
          return {
            success: false,
            error: 'AI analysis needs DeepSpace AI credits on your account. Add credits and try again.',
            code: 'ai_payment_required',
          }
        }
        return { success: false, error: 'The AI analyst is unavailable right now. Try again shortly.', code: 'ai_unavailable' }
      }

      let raw: unknown
      try {
        raw = extractJsonObject(text)
      } catch {
        return { success: false, error: 'The AI returned an unreadable answer. Try rephrasing the question.', code: 'ai_invalid_response' }
      }
      const analysis = validateAnalysis(raw, new Set(evidence.map((item) => item.recordId)))
      return { success: true, data: { analysis, evidenceCount: evidence.length } }
    }),
  }
}

export const analystActions = createAnalystActions(deepSpaceAnalystModel)
