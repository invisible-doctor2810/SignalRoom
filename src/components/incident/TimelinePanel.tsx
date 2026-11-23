import { useState } from 'react'
import type { RecordData } from 'deepspace'
import { Badge, Button, Checkbox, Modal, useToast } from '@/components/ui'
import { LIMITS, type TimelineEventData } from '@/domain/incident-model'
import { callAction } from '@/lib/actions'
import { cn } from '@/lib/utils'
import {
  ChoiceField,
  EmptyPanel,
  ReadOnlyNotice,
  SectionHeader,
  TextAreaField,
  TextField,
  formatTime,
  fromLocalInput,
  toLocalInput,
} from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'
import { ConfirmDeleteButton } from './ConfirmDeleteButton'

const NO_EVIDENCE = '__none__'

export function TimelinePanel({ workspace }: { workspace: IncidentWorkspace }) {
  const canWrite = workspace.can('timeline.write')
  const [editing, setEditing] = useState<RecordData<TimelineEventData> | 'new' | null>(null)

  return (
    <section aria-label="Timeline">
      <SectionHeader
        title="Timeline"
        description="Chronological reconstruction of what happened, oldest first."
        action={canWrite ? <Button onClick={() => setEditing('new')}>Add event</Button> : undefined}
      />
      {!canWrite && <div className="mb-4"><ReadOnlyNotice closed={workspace.isClosed} /></div>}

      {workspace.timeline.length === 0 ? (
        <EmptyPanel title="No timeline events yet" description="Record when the incident started and what changed." />
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {workspace.timeline.map((record) => {
            const evidence = record.data.sourceEvidenceId
              ? workspace.evidenceById.get(record.data.sourceEvidenceId)
              : undefined
            const important = Boolean(record.data.important)
            return (
              <li key={record.recordId} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    'absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full border-2 border-shell-panel',
                    important ? 'bg-warning' : 'bg-muted-foreground',
                  )}
                />
                <article
                  aria-label={`Timeline event: ${record.data.title}`}
                  className={cn(
                    'rounded-xl border bg-card p-4',
                    important ? 'border-warning/60' : 'border-border',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <time dateTime={record.data.occurredAt} className="text-xs text-muted-foreground">
                        {formatTime(record.data.occurredAt)}
                      </time>
                      <h3 className="mt-0.5 break-words font-medium text-foreground">{record.data.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {important && <Badge variant="warning">Important</Badge>}
                      {canWrite && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(record)}>Edit</Button>
                          <ConfirmDeleteButton
                            accessibleName={`Delete timeline event ${record.data.title}`}
                            title={`Delete “${record.data.title}”?`}
                            description="This permanently removes the event from the timeline. Linked evidence is not affected."
                            successMessage="Timeline event deleted"
                            run={() =>
                              callAction('deleteTimelineEvent', {
                                incidentId: workspace.incidentId,
                                timelineEventId: record.recordId,
                              })
                            }
                          />
                        </>
                      )}
                    </div>
                  </div>
                  {record.data.description && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {record.data.description}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {record.data.sourceEvidenceId && (
                      <>Evidence: {evidence ? evidence.data.title : 'Unavailable'} · </>
                    )}
                    Recorded by {workspace.userName(record.createdBy)}
                  </p>
                </article>
              </li>
            )
          })}
        </ol>
      )}

      {editing && (
        <TimelineForm
          workspace={workspace}
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function TimelineForm({
  workspace,
  record,
  onClose,
}: {
  workspace: IncidentWorkspace
  record: RecordData<TimelineEventData> | null
  onClose: () => void
}) {
  const { success, error } = useToast()
  const [title, setTitle] = useState(record?.data.title ?? '')
  const [description, setDescription] = useState(record?.data.description ?? '')
  const [occurredAt, setOccurredAt] = useState(() =>
    toLocalInput(record?.data.occurredAt ?? new Date().toISOString()),
  )
  const [evidenceId, setEvidenceId] = useState(record?.data.sourceEvidenceId || NO_EVIDENCE)
  const [important, setImportant] = useState(Boolean(record?.data.important))
  const [saving, setSaving] = useState(false)

  const evidenceOptions: Array<readonly [string, string]> = [
    [NO_EVIDENCE, 'No linked evidence'],
    ...workspace.evidence.map((item) => [item.recordId, item.data.title] as const),
  ]

  async function save() {
    const iso = fromLocalInput(occurredAt)
    if (!title.trim() || !iso) {
      error('Missing information', 'Title and a valid event time are required.')
      return
    }
    setSaving(true)
    const payload = {
      incidentId: workspace.incidentId,
      title,
      description,
      occurredAt: iso,
      sourceEvidenceId: evidenceId === NO_EVIDENCE ? '' : evidenceId,
      important,
    }
    try {
      if (record) {
        await callAction('updateTimelineEvent', { ...payload, timelineEventId: record.recordId })
        success('Timeline event updated')
      } else {
        await callAction('createTimelineEvent', payload)
        success('Timeline event added')
      }
      onClose()
    } catch (cause) {
      error('Could not save event', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label={record ? 'Edit timeline event' : 'Add timeline event'}>
      <div className="space-y-4 overflow-y-auto p-1">
        <h2 className="text-lg font-semibold text-foreground">
          {record ? 'Edit timeline event' : 'Add timeline event'}
        </h2>
        <TextField label="Title" value={title} onChange={setTitle} maxLength={LIMITS.title} />
        <TextAreaField label="Description" value={description} onChange={setDescription} maxLength={LIMITS.description} />
        <TextField label="Event time" type="datetime-local" value={occurredAt} onChange={setOccurredAt} />
        <ChoiceField label="Linked evidence" value={evidenceId} onChange={setEvidenceId} options={evidenceOptions} />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={important} onCheckedChange={(checked) => setImportant(checked === true)} />
          Mark as an important event
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : record ? 'Save changes' : 'Add event'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
