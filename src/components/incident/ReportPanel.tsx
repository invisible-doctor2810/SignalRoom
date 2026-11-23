import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui'
import type { IncidentMemberView } from '@/domain/incident-model'
import { buildResolutionReport } from '@/domain/resolution-report'
import { callAction } from '@/lib/actions'
import { SectionHeader } from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

/** Resolution report built from the live, persisted records; exportable as Markdown. */
export function ReportPanel({ workspace }: { workspace: IncidentWorkspace }) {
  const [members, setMembers] = useState<IncidentMemberView[]>([])
  const { incidentId } = workspace

  useEffect(() => {
    let alive = true
    callAction<{ members: IncidentMemberView[] }>('listIncidentMembers', { incidentId })
      .then((data) => alive && setMembers(data.members.filter((member) => member.status === 'active')))
      .catch(() => alive && setMembers([]))
    return () => {
      alive = false
    }
  }, [incidentId])

  const markdown = useMemo(
    () =>
      buildResolutionReport({
        incident: workspace.incident!.data,
        evidence: workspace.evidence,
        timeline: workspace.timeline,
        hypotheses: workspace.hypotheses,
        links: workspace.links,
        members,
        userName: workspace.userName,
        generatedAt: new Date(),
        generatedBy: workspace.currentUserId ? workspace.userName(workspace.currentUserId) : 'Unknown user',
      }),
    [workspace, members],
  )

  function exportMarkdown() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const slug = workspace.incident!.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    link.href = url
    link.download = `signalroom-report-${slug || 'incident'}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="Resolution report">
      <SectionHeader
        title="Resolution report"
        description="Generated from this incident's records. Confirmed findings use only Verified evidence and Supported hypotheses."
        action={<Button onClick={exportMarkdown}>Export Markdown</Button>}
      />
      <article className="prose-report rounded-xl border border-border bg-card p-5 text-sm text-foreground [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-medium [&_li]:ml-5 [&_li]:list-disc [&_p]:my-2 [&_table]:my-2 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        <div className="overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      </article>
    </section>
  )
}
