import { useState } from 'react'
import { Badge, Button, Textarea } from '@/components/ui'
import type { IncidentAnalysis } from '@/domain/ai-analysis'
import { callAction } from '@/lib/actions'
import { EmptyPanel, SectionHeader } from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

const SUGGESTED_QUESTIONS = [
  'Summarize the incident so far.',
  'Which hypothesis is best supported by the evidence, and what contradicts it?',
  'What information is missing to confirm the root cause?',
  'What should we investigate next?',
  'Draft the findings for the resolution report.',
]

interface Turn {
  id: number
  question: string
  status: 'loading' | 'done' | 'error'
  analysis?: IncidentAnalysis
  error?: string
}

/**
 * AI analyst. Answers are generated server-side from THIS incident's records
 * only, and every evidence citation is validated before it reaches this
 * panel. Answers are not saved and never change investigation records.
 */
export function AnalystPanel({ workspace }: { workspace: IncidentWorkspace }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const busy = turns.some((turn) => turn.status === 'loading')

  async function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    const id = Date.now()
    setTurns((prev) => [...prev, { id, question: trimmed, status: 'loading' }])
    setQuestion('')
    try {
      const data = await callAction<{ analysis: IncidentAnalysis }>('analyzeIncident', {
        incidentId: workspace.incidentId,
        question: trimmed,
      })
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, status: 'done', analysis: data.analysis } : turn)))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The analyst could not answer.'
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, status: 'error', error: message } : turn)))
    }
  }

  return (
    <section aria-label="AI Analyst">
      <SectionHeader
        title="AI Analyst"
        description="Analyzes this incident's evidence, timeline and hypotheses. Suggestions require human review."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((suggestion) => (
          <Button key={suggestion} size="sm" variant="outline" disabled={busy} onClick={() => void ask(suggestion)}>
            {suggestion}
          </Button>
        ))}
      </div>
      <form
        className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(question)
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Ask the analyst</span>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={1000}
            placeholder="Ask about this incident…"
            className="min-h-[44px]"
          />
        </label>
        <Button type="submit" disabled={busy || !question.trim()}>{busy ? 'Analyzing…' : 'Ask'}</Button>
      </form>

      {turns.length === 0 ? (
        <EmptyPanel
          title="No questions yet"
          description="Pick a suggested question or ask your own. Answers are not saved and never change records."
        />
      ) : (
        <ol className="space-y-5">
          {[...turns].reverse().map((turn) => (
            <li key={turn.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium text-foreground">{turn.question}</p>
              {turn.status === 'loading' && (
                <p className="mt-3 animate-pulse text-sm text-muted-foreground" role="status">Analyzing the incident records…</p>
              )}
              {turn.status === 'error' && (
                <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {turn.error}
                </p>
              )}
              {turn.analysis && <AnalysisView analysis={turn.analysis} workspace={workspace} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function EvidenceRef({ id, workspace }: { id: string; workspace: IncidentWorkspace }) {
  const evidence = workspace.evidenceById.get(id)
  return (
    <span
      title={evidence?.data.description}
      className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
    >
      {evidence ? evidence.data.title : 'Evidence no longer available'}
      {evidence && <span className="text-muted-foreground">· {evidence.data.verificationStatus}</span>}
    </span>
  )
}

function Block({ title, tone, children }: { title: string; tone?: 'fact' | 'suggestion' | 'unknown'; children: React.ReactNode }) {
  const badge = tone === 'fact' ? 'Evidence-backed' : tone === 'suggestion' ? 'Suggestion · needs review' : tone === 'unknown' ? 'Unknown' : null
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        {badge && <Badge variant={tone === 'fact' ? 'success' : tone === 'suggestion' ? 'info' : 'warning'} size="sm">{badge}</Badge>}
      </div>
      {children}
    </div>
  )
}

function AnalysisView({ analysis, workspace }: { analysis: IncidentAnalysis; workspace: IncidentWorkspace }) {
  const list = (items: string[]) =>
    items.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
      <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    )
  return (
    <div aria-label="Structured findings" role="group">
      <Block title="Summary" tone="suggestion">
        <p className="text-sm text-foreground">{analysis.summary || 'No summary returned.'}</p>
      </Block>
      <Block title="Established facts" tone="fact">
        {analysis.establishedFacts.length === 0 ? <p className="text-sm text-muted-foreground">None established by cited evidence.</p> : (
          <ul className="space-y-2 text-sm text-foreground">
            {analysis.establishedFacts.map((fact, i) => (
              <li key={i}>
                {fact.statement}
                <div className="mt-1 flex flex-wrap gap-1">{fact.evidenceIds.map((ev) => <EvidenceRef key={ev} id={ev} workspace={workspace} />)}</div>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Possible explanations" tone="suggestion">
        {analysis.hypotheses.length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
          <ul className="space-y-2 text-sm text-foreground">
            {analysis.hypotheses.map((hypothesis, i) => (
              <li key={i}>
                <span className="font-medium">{hypothesis.title}</span> — {hypothesis.rationale}
                <div className="mt-1 flex flex-wrap gap-1">{hypothesis.evidenceIds.map((ev) => <EvidenceRef key={ev} id={ev} workspace={workspace} />)}</div>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <div className="grid gap-x-6 md:grid-cols-2">
        {(['supportingEvidence', 'contradictingEvidence'] as const).map((key) => (
          <Block key={key} title={key === 'supportingEvidence' ? 'Supporting evidence' : 'Contradicting evidence'} tone="suggestion">
            {analysis[key].length === 0 ? <p className="text-sm text-muted-foreground">None</p> : (
              <ul className="space-y-1.5 text-sm text-foreground">
                {analysis[key].map((item) => (
                  <li key={item.evidenceId}><EvidenceRef id={item.evidenceId} workspace={workspace} /> {item.explanation}</li>
                ))}
              </ul>
            )}
          </Block>
        ))}
      </div>
      <Block title="Missing information" tone="unknown">{list(analysis.missingInformation)}</Block>
      <Block title="Recommended next steps" tone="suggestion">{list(analysis.recommendedActions)}</Block>
      <Block title="Uncertainty"><p className="text-sm text-foreground">{analysis.uncertainty || 'Not stated.'}</p></Block>
      {analysis.rejectedReferences.length > 0 && (
        <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {analysis.rejectedReferences.length} citation(s) did not match evidence in this incident and were removed.
        </p>
      )}
    </div>
  )
}
