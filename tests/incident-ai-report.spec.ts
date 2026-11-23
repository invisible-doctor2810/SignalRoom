/**
 * AI Analyst + Resolution report in a real browser.
 *
 * The report is deterministic and fully asserted. The AI call goes to the
 * live DeepSpace AI proxy: the test requires either validated structured
 * findings or a handled error, and records which one happened.
 */
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 2, `Needs 2 usable test accounts, found ${usableTestAccounts}.`)

type ActionResponse = { success?: boolean; code?: string; error?: string; data?: Record<string, unknown> }

async function actionAs(page: Page, name: string, params: Record<string, unknown>): Promise<ActionResponse> {
  return page.evaluate(async ({ name, params }) => {
    const tokenResponse = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    const { token } = (await tokenResponse.json()) as { token?: string }
    const response = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    return response.json()
  }, { name, params })
}

async function data<T>(page: Page, name: string, params: Record<string, unknown>): Promise<T> {
  const result = await actionAs(page, name, params)
  expect(result, `${name} should succeed`).toMatchObject({ success: true })
  return result.data as T
}

test('AI analyst is incident-scoped and the resolution report renders and exports', async ({ users }) => {
  test.setTimeout(240_000)
  const [owner, outsider] = await users(['SignalRoom Owner', 'SignalRoom Investigator'])
  const stamp = Date.now()
  const t = (name: string) => `__test-${stamp}__ ${name}`
  await owner.page.goto('/dashboard')
  await outsider.page.goto('/dashboard')

  const { incidentId } = await data<{ incidentId: string }>(owner.page, 'createIncident', {
    title: t('Checkout outage'), description: 'Checkout returned 503s for 20 minutes.', category: 'Payments',
    severity: 'High', initialTimestamp: new Date(Date.now() - 3_600_000).toISOString(),
  })
  const { evidenceId } = await data<{ evidenceId: string }>(owner.page, 'createEvidence', {
    incidentId, title: t('Pool graph'), description: 'DB connection pool at 100% from 18:02.', type: 'Metric',
    source: 'Grafana', verificationStatus: 'Verified',
  })
  const { hypothesisId } = await data<{ hypothesisId: string }>(owner.page, 'createHypothesis', {
    incidentId, title: t('Pool exhaustion'), explanation: 'Deploy doubled connections per pod.', status: 'Supported',
  })
  await data(owner.page, 'setEvidenceLink', { incidentId, evidenceId, hypothesisId, relationship: 'Supports' })
  await data(owner.page, 'createHypothesis', {
    incidentId, title: t('DNS failure'), explanation: 'Resolver outage.', status: 'Under Investigation',
  })
  await data(owner.page, 'createTimelineEvent', {
    incidentId, title: t('Pool saturated'), occurredAt: new Date(Date.now() - 3_000_000).toISOString(),
    sourceEvidenceId: evidenceId, important: true,
  })

  // ── AI context is incident-scoped: non-members are refused ─────────────
  expect(await actionAs(outsider.page, 'analyzeIncident', { incidentId, question: 'Summarize' }))
    .toMatchObject({ success: false, code: 'not_found' })

  // ── Resolution report ───────────────────────────────────────────────────
  await owner.page.goto(`/incidents/${incidentId}`)
  await owner.page.getByRole('tab', { name: 'Report' }).click()
  const report = owner.page.getByRole('region', { name: 'Resolution report' })
  for (const heading of [
    '1. Incident overview', '2. Executive summary', '3. Verified incident timeline', '4. Evidence reviewed',
    '5. Hypotheses evaluated', '6. Established findings', '7. Unresolved questions', '8. Final resolution',
    '9. Investigator information',
  ]) {
    await expect(report.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15_000 })
  }
  await expect(report).toContainText(`Leading explanation: ${t('Pool exhaustion')}`)
  await expect(report).toContainText(`verified by evidence “${t('Pool graph')}”`)
  await expect(report).toContainText(`Hypothesis “${t('DNS failure')}” is Under Investigation.`)
  await expect(report).toContainText('— Owner')

  const downloadPromise = owner.page.waitForEvent('download')
  await owner.page.getByRole('button', { name: 'Export Markdown' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^signalroom-report-.+\.md$/)
  const exported = await readFile(await download.path(), 'utf8')
  // Raw Markdown escapes user text so it renders literally (`__x__` is not bold).
  expect(exported).toContain(`# Resolution report: \\_\\_test\\-${stamp}\\_\\_ Checkout outage`)
  expect(exported).toContain('## 9. Investigator information')
  await owner.page.screenshot({ path: '.deepspace/screenshots/final-01-report.png', fullPage: true })

  // ── AI Analyst UI: one live call; findings or a handled error ──────────
  await owner.page.getByRole('tab', { name: 'AI Analyst' }).click()
  await owner.page.getByRole('button', { name: 'Summarize the incident so far.' }).click()
  await expect(owner.page.getByRole('status')).toContainText('Analyzing', { timeout: 10_000 })
  const findings = owner.page.getByRole('group', { name: 'Structured findings' })
  const failure = owner.page.getByRole('alert').filter({ hasText: /AI|analyst|answer|unavailable|credits|Request failed/i })
  await expect(findings.or(failure)).toBeVisible({ timeout: 150_000 })
  if (await findings.isVisible()) {
    test.info().annotations.push({ type: 'ai-outcome', description: 'live structured findings returned' })
    await expect(findings.getByText('Evidence-backed')).toBeVisible()
    await expect(findings.getByText('Suggestion · needs review').first()).toBeVisible()
    // Any citation chip rendered must name real evidence from this incident.
    await expect(findings.getByText('Evidence no longer available')).toHaveCount(0)
  } else {
    test.info().annotations.push({ type: 'ai-outcome', description: `handled error: ${await failure.textContent()}` })
  }
  await owner.page.screenshot({ path: '.deepspace/screenshots/final-02-analyst.png', fullPage: true })
})
