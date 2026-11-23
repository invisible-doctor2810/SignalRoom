import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Button, Modal, useToast } from '@/components/ui'
import {
  EVIDENCE_RELATIONSHIPS,
  HYPOTHESIS_STATUSES,
  LIMITS,
  type EvidenceRelationship,
  type HypothesisData,
} from '@/domain/incident-model'
import { callAction } from '@/lib/actions'
import {
  ChoiceField,
  EmptyPanel,
  ReadOnlyNotice,
  SectionHeader,
  StatusBadge,
  TextAreaField,
  TextField,
  pairs,
} from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

export function HypothesesPanel({ workspace }: { workspace: IncidentWorkspace }) {
  const canWrite = workspace.can('hypothesis.write')
  const [editing, setEditing] = useState<RecordData<HypothesisData> | 'new' | null>(null)
  const [linking, setLinking] = useState<RecordData<HypothesisData> | null>(null)

  return (
    <section aria-label="Hypotheses">
      <SectionHeader
        title="Hypotheses"
        description="Competing explanations, weighed against the evidence."
        action={canWrite ? <Button onClick={() => setEditing('new')}>Add hypothesis</Button> : undefined}
      />
      {!canWrite && <div className="mb-4"><ReadOnlyNotice closed={workspace.isClosed} /></div>}

      {workspace.hypotheses.length === 0 ? (
        <EmptyPanel title="No hypotheses yet" description="Propose an explanation and link evidence for and against it." />
      ) : (
        <ul className="grid gap-3">
          {workspace.hypotheses.map((record) => (
            <li key={record.recordId}>
              <HypothesisCard
                workspace={workspace}
                record={record}
                canWrite={canWrite}
                onEdit={() => setEditing(record)}
                onLink={() => setLinking(record)}
              />
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <HypothesisForm
          incidentId={workspace.incidentId}
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {linking && (
        <LinkEvidenceForm workspace={workspace} hypothesis={linking} onClose={() => setLinking(null)} />
      )}
    </section>
  )
}

function HypothesisCard({
  workspace,
  record,
  canWrite,
  onEdit,
  onLink,
}: {
  workspace: IncidentWorkspace
  record: RecordData<HypothesisData>
  canWrite: boolean
  onEdit: () => void
  onLink: () => void
}) {
  const { success, error } = useToast()
  const links = workspace.links.filter((link) => link.data.hypothesisId === record.recordId)

  async function unlink(evidenceId: string) {
    try {
      await callAction('removeEvidenceLink', {
        incidentId: workspace.incidentId,
        evidenceId,
        hypothesisId: record.recordId,
      })
      success('Evidence unlinked')
    } catch (cause) {
      error('Could not unlink evidence', cause instanceof Error ? cause.message : 'Unknown error')
    }
  }

  return (
    <article aria-label={`Hypothesis: ${record.data.title}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-medium text-foreground">{record.data.title}</h3>
        <div className="flex items-center gap-2">
          <StatusBadge value={record.data.status} />
          {canWrite && <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{record.data.explanation}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {EVIDENCE_RELATIONSHIPS.map((relationship) => {
          const group = links.filter((link) => link.data.relationship === relationship)
          return (
            <div key={relationship} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {relationship === 'Supports' ? 'Supporting' : relationship === 'Contradicts' ? 'Contradicting' : 'Neutral'}
                {' '}({group.length})
              </p>
              {group.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
              ) : (
                <ul className="space-y-1.5">
                  {group.map((link) => (
                    <li key={link.recordId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words text-foreground">
                        {workspace.evidenceById.get(link.data.evidenceId)?.data.title ?? 'Unavailable evidence'}
                      </span>
                      {canWrite && (
                        <button
                          type="button"
                          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => unlink(link.data.evidenceId)}
                        >
                          Unlink
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Proposed by {workspace.userName(record.createdBy)}</p>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={onLink} disabled={workspace.evidence.length === 0}>
            Link evidence
          </Button>
        )}
      </div>
    </article>
  )
}

function HypothesisForm({
  incidentId,
  record,
  onClose,
}: {
  incidentId: string
  record: RecordData<HypothesisData> | null
  onClose: () => void
}) {
  const { success, error } = useToast()
  const [title, setTitle] = useState(record?.data.title ?? '')
  const [explanation, setExplanation] = useState(record?.data.explanation ?? '')
  const [status, setStatus] = useState<string>(record?.data.status ?? 'Proposed')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || !explanation.trim()) {
      error('Missing information', 'Title and explanation are required.')
      return
    }
    setSaving(true)
    try {
      if (record) {
        await callAction('updateHypothesis', { incidentId, hypothesisId: record.recordId, title, explanation, status })
        success('Hypothesis updated')
      } else {
        await callAction('createHypothesis', { incidentId, title, explanation, status })
        success('Hypothesis added')
      }
      onClose()
    } catch (cause) {
      error('Could not save hypothesis', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label={record ? 'Edit hypothesis' : 'Add hypothesis'}>
      <div className="space-y-4 overflow-y-auto p-1">
        <h2 className="text-lg font-semibold text-foreground">{record ? 'Edit hypothesis' : 'Add hypothesis'}</h2>
        <TextField label="Title" value={title} onChange={setTitle} maxLength={LIMITS.title} />
        <TextAreaField label="Explanation" value={explanation} onChange={setExplanation} maxLength={LIMITS.description} />
        <ChoiceField label="Hypothesis status" value={status} onChange={setStatus} options={pairs(HYPOTHESIS_STATUSES)} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : record ? 'Save changes' : 'Add hypothesis'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function LinkEvidenceForm({
  workspace,
  hypothesis,
  onClose,
}: {
  workspace: IncidentWorkspace
  hypothesis: RecordData<HypothesisData>
  onClose: () => void
}) {
  const { success, error } = useToast()
  const [evidenceId, setEvidenceId] = useState(workspace.evidence[0]?.recordId ?? '')
  const [relationship, setRelationship] = useState<EvidenceRelationship>('Supports')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!evidenceId) return
    setSaving(true)
    try {
      await callAction('setEvidenceLink', {
        incidentId: workspace.incidentId,
        evidenceId,
        hypothesisId: hypothesis.recordId,
        relationship,
      })
      success('Evidence linked')
      onClose()
    } catch (cause) {
      error('Could not link evidence', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label="Link evidence">
      <div className="space-y-4 p-1">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Link evidence</h2>
          <p className="text-sm text-muted-foreground">{hypothesis.data.title}</p>
        </div>
        <ChoiceField
          label="Evidence"
          value={evidenceId}
          onChange={setEvidenceId}
          options={workspace.evidence.map((item) => [item.recordId, item.data.title] as const)}
        />
        <ChoiceField
          label="Relationship"
          value={relationship}
          onChange={(value) => setRelationship(value as EvidenceRelationship)}
          options={pairs(EVIDENCE_RELATIONSHIPS)}
        />
        <p className="text-xs text-muted-foreground">
          Linking the same evidence again replaces its previous relationship to this hypothesis.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !evidenceId}>{saving ? 'Saving...' : 'Save link'}</Button>
        </div>
      </div>
    </Modal>
  )
}
