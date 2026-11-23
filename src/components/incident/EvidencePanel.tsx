import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Button, Modal, SearchInput, useToast } from '@/components/ui'
import {
  EVIDENCE_TYPES,
  LIMITS,
  VERIFICATION_STATUSES,
  type EvidenceData,
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
  formatTime,
  pairs,
} from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

type Draft = Pick<EvidenceData, 'title' | 'description' | 'type' | 'source' | 'verificationStatus'>

const EMPTY: Draft = { title: '', description: '', type: 'Log', source: '', verificationStatus: 'Unverified' }

export function EvidencePanel({ workspace }: { workspace: IncidentWorkspace }) {
  const canWrite = workspace.can('evidence.write')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<RecordData<EvidenceData> | 'new' | null>(null)

  const term = search.trim().toLowerCase()
  const visible = workspace.evidence.filter((record) =>
    !term ||
    [record.data.title, record.data.description, record.data.source, record.data.type]
      .some((value) => value.toLowerCase().includes(term)),
  )

  return (
    <section aria-label="Evidence">
      <SectionHeader
        title="Evidence"
        description="Observations, logs, metrics and documents collected for this incident."
        action={canWrite ? <Button onClick={() => setEditing('new')}>Add evidence</Button> : undefined}
      />
      {!canWrite && <div className="mb-4"><ReadOnlyNotice closed={workspace.isClosed} /></div>}
      <SearchInput
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onClear={() => setSearch('')}
        placeholder="Search evidence"
        className="mb-4 md:max-w-sm"
      />

      {workspace.evidence.length === 0 ? (
        <EmptyPanel title="No evidence yet" description="Add the first observation to start building the case." />
      ) : visible.length === 0 ? (
        <EmptyPanel title="No matching evidence" description="Try a different search term." />
      ) : (
        <ul className="grid gap-3">
          {visible.map((record) => (
            <li key={record.recordId}>
              <article
                aria-label={`Evidence: ${record.data.title}`}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {record.data.type}
                      {record.data.source ? ` · ${record.data.source}` : ''}
                    </p>
                    <h3 className="mt-0.5 break-words font-medium text-foreground">{record.data.title}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={record.data.verificationStatus} />
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(record)}>Edit</Button>
                    )}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {record.data.description}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Added by {workspace.userName(record.createdBy)} · {formatTime(record.createdAt)}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EvidenceForm
          incidentId={workspace.incidentId}
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function EvidenceForm({
  incidentId,
  record,
  onClose,
}: {
  incidentId: string
  record: RecordData<EvidenceData> | null
  onClose: () => void
}) {
  const { success, error } = useToast()
  const [draft, setDraft] = useState<Draft>(() =>
    record
      ? {
          title: record.data.title,
          description: record.data.description,
          type: record.data.type,
          source: record.data.source ?? '',
          verificationStatus: record.data.verificationStatus,
        }
      : EMPTY,
  )
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(key: K) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }))

  async function save() {
    if (!draft.title.trim() || !draft.description.trim()) {
      error('Missing information', 'Title and description are required.')
      return
    }
    setSaving(true)
    try {
      if (record) {
        await callAction('updateEvidence', { incidentId, evidenceId: record.recordId, ...draft })
        success('Evidence updated')
      } else {
        await callAction('createEvidence', { incidentId, ...draft })
        success('Evidence added')
      }
      onClose()
    } catch (cause) {
      error('Could not save evidence', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label={record ? 'Edit evidence' : 'Add evidence'}>
      <div className="space-y-4 overflow-y-auto p-1">
        <h2 className="text-lg font-semibold text-foreground">{record ? 'Edit evidence' : 'Add evidence'}</h2>
        <TextField label="Title" value={draft.title} onChange={set('title')} maxLength={LIMITS.title} />
        <TextAreaField
          label="Description"
          value={draft.description}
          onChange={set('description')}
          maxLength={LIMITS.description}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceField label="Evidence type" value={draft.type} onChange={set('type')} options={pairs(EVIDENCE_TYPES)} />
          <ChoiceField
            label="Verification status"
            value={draft.verificationStatus}
            onChange={set('verificationStatus')}
            options={pairs(VERIFICATION_STATUSES)}
          />
        </div>
        <TextField
          label="Source"
          value={draft.source}
          onChange={set('source')}
          maxLength={LIMITS.source}
          placeholder="e.g. Grafana dashboard, PagerDuty alert, Slack thread"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : record ? 'Save changes' : 'Add evidence'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
