import { useState } from 'react'
import { Button, Modal, useToast } from '@/components/ui'
import {
  INCIDENT_SEVERITIES,
  LIMITS,
  SETTABLE_INCIDENT_STATUSES,
  type IncidentData,
} from '@/domain/incident-model'
import { callAction } from '@/lib/actions'
import {
  ChoiceField,
  SectionHeader,
  TextAreaField,
  TextField,
  formatTime,
  pairs,
} from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

export function OverviewPanel({ workspace }: { workspace: IncidentWorkspace }) {
  const incident = workspace.incident!.data
  const canEdit = workspace.can('incident.update')
  const [editing, setEditing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const { success, error } = useToast()

  async function reopen() {
    setReopening(true)
    try {
      await callAction('updateIncident', { incidentId: workspace.incidentId, status: 'Open' })
      success('Incident reopened')
    } catch (cause) {
      error('Could not reopen incident', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setReopening(false)
    }
  }

  const headerAction = !canEdit
    ? undefined
    : workspace.isClosed
      ? <Button variant="outline" onClick={reopen} disabled={reopening}>{reopening ? 'Reopening...' : 'Reopen incident'}</Button>
      : <Button variant="outline" onClick={() => setEditing(true)}>Edit incident</Button>

  const verified = workspace.evidence.filter((record) => record.data.verificationStatus === 'Verified').length
  const disputed = workspace.evidence.filter((record) => record.data.verificationStatus === 'Disputed').length
  const openHypotheses = workspace.hypotheses.filter(
    (record) => record.data.status === 'Proposed' || record.data.status === 'Under Investigation',
  ).length
  const important = workspace.timeline.filter((record) => Boolean(record.data.important)).length

  return (
    <section aria-label="Overview">
      <SectionHeader title="Overview" action={headerAction} />
      {workspace.isClosed && (
        <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          This incident is closed. All investigation records are read-only
          {canEdit ? '. Reopen it to make changes.' : ' until the Owner reopens it.'}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{incident.description}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <Fact label="Category" value={incident.category} />
            <Fact label="Incident time" value={formatTime(incident.initialTimestamp)} />
            <Fact label="Owner" value={workspace.userName(incident.ownerId)} />
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat label="Evidence" value={workspace.evidence.length} detail={`${verified} verified · ${disputed} disputed`} />
          <Stat label="Open hypotheses" value={openHypotheses} detail={`${workspace.hypotheses.length} total`} />
          <Stat label="Timeline events" value={workspace.timeline.length} detail={`${important} important`} />
        </div>
      </div>
      {editing && <IncidentForm incidentId={workspace.incidentId} incident={incident} onClose={() => setEditing(false)} />}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{value}</dd>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function IncidentForm({
  incidentId,
  incident,
  onClose,
}: {
  incidentId: string
  incident: IncidentData
  onClose: () => void
}) {
  const { success, error } = useToast()
  const [title, setTitle] = useState(incident.title)
  const [description, setDescription] = useState(incident.description)
  const [category, setCategory] = useState(incident.category)
  const [severity, setSeverity] = useState<string>(incident.severity)
  const [status, setStatus] = useState<string>(incident.status === 'Creating' ? 'Open' : incident.status)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || !description.trim() || !category.trim()) {
      error('Missing information', 'Title, description and category are required.')
      return
    }
    setSaving(true)
    try {
      await callAction('updateIncident', { incidentId, title, description, category, severity, status })
      success('Incident updated')
      onClose()
    } catch (cause) {
      error('Could not update incident', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label="Edit incident">
      <div className="space-y-4 overflow-y-auto p-1">
        <h2 className="text-lg font-semibold text-foreground">Edit incident</h2>
        <TextField label="Title" value={title} onChange={setTitle} maxLength={LIMITS.title} />
        <TextAreaField label="Description" value={description} onChange={setDescription} maxLength={LIMITS.description} />
        <TextField label="Category" value={category} onChange={setCategory} maxLength={LIMITS.category} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceField label="Severity" value={severity} onChange={setSeverity} options={pairs(INCIDENT_SEVERITIES)} />
          <ChoiceField
            label="Incident status"
            value={status}
            onChange={setStatus}
            options={pairs(SETTABLE_INCIDENT_STATUSES)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  )
}
