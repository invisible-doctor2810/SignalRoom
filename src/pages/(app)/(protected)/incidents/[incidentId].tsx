/**
 * Incident workspace — /incidents/:incidentId
 *
 * Access: the RecordRoom only streams this incident's records to its active
 * team members (`read: 'team'`). A non-member, a removed member, or an
 * unknown id all see the same "not available" state. Every mutation goes
 * through a server action that re-verifies membership and role.
 */

import { Link, useParams } from 'react-router-dom'
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { EvidencePanel } from '@/components/incident/EvidencePanel'
import { HypothesesPanel } from '@/components/incident/HypothesesPanel'
import { OverviewPanel } from '@/components/incident/OverviewPanel'
import { TeamPanel } from '@/components/incident/TeamPanel'
import { TimelinePanel } from '@/components/incident/TimelinePanel'
import { StatusBadge } from '@/components/incident/fields'
import { useIncidentWorkspace } from '@/components/incident/useIncidentWorkspace'

export default function IncidentWorkspacePage() {
  const { incidentId = '' } = useParams()
  const workspace = useIncidentWorkspace(incidentId)
  const { incident, role } = workspace

  if (workspace.loading && !incident) {
    return (
      <div className="px-5 py-6 md:px-8" aria-busy="true">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-7 w-2/3 max-w-md animate-pulse rounded bg-muted" />
        <div className="mt-8 h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (workspace.error && !incident) {
    return <Unavailable title="Could not load this incident" detail={workspace.error} />
  }

  if (!incident || incident.data.status === 'Creating' || !role) {
    return (
      <Unavailable
        title="Incident not available"
        detail="This incident does not exist, or you are not a member of its investigation team."
      />
    )
  }

  return (
    <div className="min-h-full px-5 py-6 md:px-8">
      <header className="mb-6">
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← All incidents
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{incident.data.category}</p>
            <h1 className="break-words text-2xl font-semibold text-foreground">{incident.data.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={incident.data.severity} />
            <Badge variant="outline">{incident.data.status}</Badge>
            <Badge variant="info" aria-label={`Your role: ${role}`}>Your role: {role}</Badge>
          </div>
        </div>
      </header>

      <Tabs defaultValue="overview">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="evidence">Evidence ({workspace.evidence.length})</TabsTrigger>
            <TabsTrigger value="timeline">Timeline ({workspace.timeline.length})</TabsTrigger>
            <TabsTrigger value="hypotheses">Hypotheses ({workspace.hypotheses.length})</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="pt-4"><OverviewPanel workspace={workspace} /></TabsContent>
        <TabsContent value="evidence" className="pt-4"><EvidencePanel workspace={workspace} /></TabsContent>
        <TabsContent value="timeline" className="pt-4"><TimelinePanel workspace={workspace} /></TabsContent>
        <TabsContent value="hypotheses" className="pt-4"><HypothesesPanel workspace={workspace} /></TabsContent>
        <TabsContent value="team" className="pt-4"><TeamPanel workspace={workspace} /></TabsContent>
      </Tabs>
    </div>
  )
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-20">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <Link to="/dashboard" className="mt-6 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Back to incidents
        </Link>
      </div>
    </div>
  )
}
