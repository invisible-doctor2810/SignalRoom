/**
 * Public landing — a STATIC page (no auth fetch, no realtime connection).
 * It is prerendered to HTML at build time (prerender.ts), so keep it
 * renderable without a browser. "Open SignalRoom" goes to the investigations
 * dashboard, which shows the sign-in panel to signed-out visitors.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const FEATURES = [
  {
    title: 'Evidence with provenance',
    body: 'Collect logs, metrics, alerts and observations with source, verification status and who added them.',
  },
  {
    title: 'A timeline you can trust',
    body: 'Rebuild what happened in order, link events to evidence, and flag the moments that matter.',
  },
  {
    title: 'Hypotheses against evidence',
    body: 'Track competing explanations and record which evidence supports, contradicts or is neutral to each.',
  },
  {
    title: 'Live collaboration',
    body: 'Changes appear for every member instantly, and you can see who else is in the incident.',
  },
  {
    title: 'Grounded AI analyst',
    body: 'Analysis built only from the incident’s own records; every evidence citation is validated.',
  },
  {
    title: 'Resolution report',
    body: 'A nine-section report that separates confirmed findings from open questions, exportable as Markdown.',
  },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-primary">{APP_NAME}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Investigate incidents together, from the facts.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground">
            When something breaks, the evidence ends up scattered across logs, chats and people’s heads.
            {' '}{APP_NAME} gives every incident one shared, access-controlled workspace for evidence,
            timeline, hypotheses and the final report.
          </p>
          <Link
            to="/dashboard"
            className="mt-8 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open {APP_NAME}
          </Link>
        </div>
        <ul className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-xl border border-border bg-card p-5 text-left">
              <h2 className="text-sm font-semibold text-foreground">{feature.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-10 max-w-4xl text-center text-xs text-muted-foreground">
          Roles: Owner, Investigator, Viewer · Closed incidents are read-only · Built on DeepSpace
        </p>
      </div>
    </>
  )
}
