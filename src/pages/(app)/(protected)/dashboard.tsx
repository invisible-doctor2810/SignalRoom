import { useState } from 'react'
import { getAuthToken, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import {
  Badge,
  Button,
  Input,
  Modal,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui'

type Incident = {
  incidentId: string
  title: string
  description: string
  category: string
  severity: 'Low' | 'Medium' | 'High' | 'Critical'
  status: 'Creating' | 'Open' | 'Investigating' | 'Resolved' | 'Closed'
  ownerId: string
  initialTimestamp: string
}

export default function DashboardPage() {
  const { records, status } = useQuery<Incident>('incidents', {
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { success, error } = useToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [severity, setSeverity] = useState<Incident['severity']>('Medium')
  const [initialTimestamp, setInitialTimestamp] = useState(() =>
    new Date().toISOString().slice(0, 16),
  )

  async function createIncident() {
    if (!title.trim() || !description.trim() || !category.trim()) {
      error('Missing information', 'Title, description, and category are required.')
      return
    }

    setSubmitting(true)
    try {
      const token = await getAuthToken()
      const response = await fetch('/api/actions/createIncident', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category: category.trim(),
          severity,
          initialTimestamp: new Date(initialTimestamp).toISOString(),
        }),
      })
      const payload = await response.json() as {
        success?: boolean
        data?: { incidentId?: string }
        error?: string
      }
      if (!response.ok || !payload.success || !payload.data?.incidentId) {
        throw new Error(payload.error || 'Incident creation failed')
      }

      success('Incident created', 'The investigation room is ready.')
      setCreateOpen(false)
      setTitle('')
      setDescription('')
      setCategory('')
      setSeverity('Medium')
      setInitialTimestamp(new Date().toISOString().slice(0, 16))
    } catch (cause) {
      error('Could not create incident', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = records.filter((record) => {
    const matchesSearch =
      record.data.title.toLowerCase().includes(search.toLowerCase()) ||
      record.data.category.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'All' || record.data.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const activeCount = records.filter((record) =>
    record.data.status === 'Open' || record.data.status === 'Investigating'
  ).length
  const criticalCount = records.filter((record) => record.data.severity === 'Critical').length

  return (
    <div className="min-h-full px-5 py-6 md:px-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Investigation Command</p>
          <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New incident</Button>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Investigations" value={records.length} />
        <Metric label="Active" value={activeCount} />
        <Metric label="Critical" value={criticalCount} />
        <Metric label="Resolved" value={records.filter((record) => record.data.status === 'Resolved').length} />
      </section>

      <section className="mb-5 flex flex-col gap-3 md:flex-row">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder="Search incidents"
          className="md:max-w-sm"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['All', 'Open', 'Investigating', 'Resolved', 'Closed'].map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {status === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading investigations...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="font-medium text-foreground">No investigations found</p>
          <p className="mt-1 text-sm text-muted-foreground">Create an incident to establish the first set of facts.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((record) => (
            <IncidentCard key={record.recordId} record={record} />
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} aria-label="Create incident">
        <div className="space-y-4 p-1">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Create incident</h2>
            <p className="text-sm text-muted-foreground">Establish the incident record and investigate from the facts.</p>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Description</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Category</span>
            <Input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Severity</span>
            <Select value={severity} onValueChange={(value) => setSeverity(value as Incident['severity'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['Low', 'Medium', 'High', 'Critical'] as const).map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Initial incident time</span>
            <Input
              type="datetime-local"
              value={initialTimestamp}
              onChange={(event) => setInitialTimestamp(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createIncident} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create incident'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

function IncidentCard({ record }: { record: RecordData<Incident> }) {
  const severityVariant = record.data.severity === 'Critical'
    ? 'destructive'
    : record.data.severity === 'High'
      ? 'warning'
      : 'secondary'

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{record.data.category}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{record.data.title}</h2>
        </div>
        <div className="flex gap-2">
          <Badge variant={severityVariant}>{record.data.severity}</Badge>
          <Badge variant="secondary">{record.data.status}</Badge>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{record.data.description}</p>
      <p className="mt-4 text-xs text-muted-foreground">
        Incident time {new Date(record.data.initialTimestamp).toLocaleString()}
      </p>
    </article>
  )
}
