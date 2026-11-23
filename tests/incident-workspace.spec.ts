/**
 * Incident workspace — two-user authorization and workflow spec.
 *
 * One Owner and one second account. The second account moves through every
 * access state: non-member → Viewer → Investigator → removed. UI flows are
 * exercised for the Owner; the second account's denials are also checked by
 * calling the server actions directly with its own bearer token, so a hidden
 * button is never mistaken for authorization.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 2, `Needs 2 usable test accounts, found ${usableTestAccounts}.`)

type ActionResponse = { success?: boolean; code?: string; error?: string; data?: Record<string, unknown> }

/** Calls a server action as the user signed in on `page`. */
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

/** Browser evidence for reviewers; .deepspace/ is gitignored. */
async function snap(page: Page, name: string) {
  await page.screenshot({ path: `.deepspace/screenshots/incident-workspace-${name}.png`, fullPage: true })
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click()
  // Exact: 'Verified' must not also match 'Unverified'.
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('incident workspace enforces membership and roles across two users', async ({ users }) => {
  test.setTimeout(180_000)
  const [owner, member] = await users(['SignalRoom Owner', 'SignalRoom Investigator'])
  const stamp = Date.now()
  const incidentTitle = `__test-${stamp}__ Checkout outage`
  const evidenceTitle = `__test-${stamp}__ Pool saturation graph`
  const hypothesisTitle = `__test-${stamp}__ Connection pool exhaustion`

  // ── Owner creates an incident and opens its workspace ──────────────────
  await owner.page.goto('/dashboard')
  await expect(owner.page.getByRole('heading', { name: 'Incidents' })).toBeVisible({ timeout: 15_000 })
  await owner.page.getByRole('button', { name: 'New incident' }).click()
  const createDialog = owner.page.getByRole('dialog')
  await createDialog.getByLabel('Title').fill(incidentTitle)
  await createDialog.getByLabel('Description').fill('Checkout requests failing with 503s.')
  await createDialog.getByLabel('Category').fill('Payments')
  await createDialog.getByRole('button', { name: 'Create incident' }).click()
  await owner.page.getByRole('link', { name: incidentTitle }).click({ timeout: 15_000 })
  await expect(owner.page).toHaveURL(/\/incidents\/[^/]+$/)
  const incidentId = owner.page.url().split('/incidents/')[1]
  await expect(owner.page.getByText('Your role: Owner')).toBeVisible({ timeout: 15_000 })
  await snap(owner.page, '01-owner-workspace')

  // ── Non-member: no records, and the server refuses every mutation ──────
  await member.page.goto(`/incidents/${incidentId}`)
  await expect(member.page.getByText('Incident not available')).toBeVisible({ timeout: 15_000 })
  await snap(member.page, '02-non-member-denied')
  expect(await actionAs(member.page, 'createEvidence', {
    incidentId, title: 'x', description: 'x', type: 'Log',
  })).toMatchObject({ success: false, code: 'not_found' })
  expect(await actionAs(member.page, 'listIncidentMembers', { incidentId }))
    .toMatchObject({ success: false, code: 'not_found' })

  // ── Owner records evidence, a timeline event and a hypothesis (UI) ─────
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  await owner.page.getByRole('button', { name: 'Add evidence' }).click()
  let dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(evidenceTitle)
  await dialog.getByLabel('Description').fill('DB pool at 100% from 18:02.')
  await dialog.getByLabel('Source').fill('Grafana')
  await dialog.getByRole('button', { name: 'Add evidence' }).click()
  const evidenceCard = owner.page.getByRole('article', { name: `Evidence: ${evidenceTitle}` })
  await expect(evidenceCard).toBeVisible({ timeout: 15_000 })
  await expect(evidenceCard.getByText('Unverified')).toBeVisible()

  await evidenceCard.getByRole('button', { name: 'Edit' }).click()
  dialog = owner.page.getByRole('dialog')
  await chooseOption(owner.page, 'Verification status', 'Verified')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(evidenceCard.getByText('Verified')).toBeVisible({ timeout: 15_000 })

  await owner.page.getByRole('tab', { name: /Timeline/ }).click()
  await owner.page.getByRole('button', { name: 'Add event' }).click()
  dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Title').fill('Pool saturated')
  await chooseOption(owner.page, 'Linked evidence', evidenceTitle)
  await dialog.getByRole('checkbox').click()
  await dialog.getByRole('button', { name: 'Add event' }).click()
  const eventCard = owner.page.getByRole('article', { name: 'Timeline event: Pool saturated' })
  await expect(eventCard).toBeVisible({ timeout: 15_000 })
  await expect(eventCard.getByText('Important')).toBeVisible()
  await expect(eventCard.getByText(`Evidence: ${evidenceTitle}`)).toBeVisible()

  await owner.page.getByRole('tab', { name: /Hypotheses/ }).click()
  await owner.page.getByRole('button', { name: 'Add hypothesis' }).click()
  dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(hypothesisTitle)
  await dialog.getByLabel('Explanation').fill('Deploy doubled connections per pod.')
  await dialog.getByRole('button', { name: 'Add hypothesis' }).click()
  const hypothesisCard = owner.page.getByRole('article', { name: `Hypothesis: ${hypothesisTitle}` })
  await expect(hypothesisCard).toBeVisible({ timeout: 15_000 })
  await hypothesisCard.getByRole('button', { name: 'Link evidence' }).click()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Save link' }).click()
  await expect(hypothesisCard.getByText('Supporting (1)')).toBeVisible({ timeout: 15_000 })
  await expect(hypothesisCard.getByText(evidenceTitle)).toBeVisible()
  await snap(owner.page, '03-owner-hypothesis-linked')

  // ── Owner adds the second account as a Viewer (UI) ─────────────────────
  await owner.page.getByRole('tab', { name: 'Team' }).click()
  await owner.page.getByRole('button', { name: 'Add member' }).click()
  dialog = owner.page.getByRole('dialog')
  await dialog.getByLabel('Email').fill(member.email)
  await chooseOption(owner.page, 'Role', 'Viewer')
  await dialog.getByRole('button', { name: 'Add member' }).click()
  // Scoped to the member list: the "…was added as Viewer." toast may still show the email.
  await expect(owner.page.getByRole('region', { name: 'Team' }).getByText(member.email, { exact: true }))
    .toBeVisible({ timeout: 15_000 })

  // ── Viewer: reads everything, mutates nothing ──────────────────────────
  await member.page.reload()
  await expect(member.page.getByText('Your role: Viewer')).toBeVisible({ timeout: 15_000 })
  await member.page.getByRole('tab', { name: /Evidence/ }).click()
  await expect(member.page.getByRole('article', { name: `Evidence: ${evidenceTitle}` })).toBeVisible()
  await expect(member.page.getByRole('button', { name: 'Add evidence' })).toHaveCount(0)
  await expect(member.page.getByText('Investigation records are read-only.')).toBeVisible()
  await snap(member.page, '04-viewer-read-only')

  const evidenceId = (
    await actionAs(owner.page, 'createEvidence', {
      incidentId, title: `__test-${stamp}__ Error log`, description: '503 spike', type: 'Log',
    })
  ).data?.evidenceId as string
  expect(evidenceId).toBeTruthy()
  expect(await actionAs(member.page, 'createEvidence', {
    incidentId, title: 'x', description: 'x', type: 'Log',
  })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await actionAs(member.page, 'updateEvidence', {
    incidentId, evidenceId, verificationStatus: 'Disputed',
  })).toMatchObject({ success: false, code: 'forbidden' })
  expect(await actionAs(member.page, 'addIncidentMember', {
    incidentId, email: owner.email, role: 'Investigator',
  })).toMatchObject({ success: false, code: 'forbidden' })

  // ── Promote to Investigator: writes are now allowed ────────────────────
  const memberUserId = (await actionAs(owner.page, 'listIncidentMembers', { incidentId })).data?.members as
    Array<{ userId: string; email?: string }>
  const target = memberUserId.find((m) => m.email?.toLowerCase() === member.email.toLowerCase())
  expect(target).toBeTruthy()
  expect(await actionAs(owner.page, 'updateIncidentMember', {
    incidentId, userId: target!.userId, role: 'Investigator',
  })).toMatchObject({ success: true })

  await expect(member.page.getByText('Your role: Investigator')).toBeVisible({ timeout: 15_000 })
  await member.page.getByRole('button', { name: 'Add evidence' }).click()
  dialog = member.page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(`__test-${stamp}__ Investigator note`)
  await dialog.getByLabel('Description').fill('Pods restarted at 18:05.')
  await dialog.getByRole('button', { name: 'Add evidence' }).click()
  // Realtime: the Owner sees the Investigator's evidence, attributed to them.
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  const investigatorCard = owner.page.getByRole('article', { name: `Evidence: __test-${stamp}__ Investigator note` })
  await expect(investigatorCard).toBeVisible({ timeout: 15_000 })
  await expect(investigatorCard.getByText(/Added by/)).not.toContainText('SignalRoom Owner')

  // Investigators still cannot administer the incident.
  expect(await actionAs(member.page, 'updateIncident', { incidentId, status: 'Closed' }))
    .toMatchObject({ success: false, code: 'forbidden' })

  // ── Cross-incident references are rejected ─────────────────────────────
  const otherIncident = await actionAs(member.page, 'createIncident', {
    title: `__test-${stamp}__ Other incident`, description: 'x', category: 'x',
    severity: 'Low', initialTimestamp: new Date().toISOString(),
  })
  const otherIncidentId = otherIncident.data?.incidentId as string
  const foreignEvidence = await actionAs(member.page, 'createEvidence', {
    incidentId: otherIncidentId, title: 'foreign', description: 'x', type: 'Log',
  })
  expect(foreignEvidence).toMatchObject({ success: true })
  expect(await actionAs(member.page, 'createTimelineEvent', {
    incidentId, title: 'x', occurredAt: new Date().toISOString(),
    sourceEvidenceId: foreignEvidence.data?.evidenceId,
  })).toMatchObject({ success: false, code: 'not_found' })
  // And the Owner of incident A cannot touch incident B.
  expect(await actionAs(owner.page, 'createEvidence', {
    incidentId: otherIncidentId, title: 'x', description: 'x', type: 'Log',
  })).toMatchObject({ success: false, code: 'not_found' })

  // ── Removal revokes reads and writes ───────────────────────────────────
  expect(await actionAs(owner.page, 'updateIncidentMember', {
    incidentId, userId: target!.userId, status: 'removed',
  })).toMatchObject({ success: true })
  await member.page.reload()
  await expect(member.page.getByText('Incident not available')).toBeVisible({ timeout: 15_000 })
  expect(await actionAs(member.page, 'createEvidence', {
    incidentId, title: 'x', description: 'x', type: 'Log',
  })).toMatchObject({ success: false, code: 'not_found' })

  // ── Closed incidents are read-only; only the Owner can reopen ──────────
  expect(await actionAs(owner.page, 'updateIncident', { incidentId, status: 'Closed' }))
    .toMatchObject({ success: true })
  await owner.page.getByRole('tab', { name: 'Overview' }).click()
  await expect(owner.page.getByRole('button', { name: 'Reopen incident' })).toBeVisible({ timeout: 15_000 })
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  await expect(owner.page.getByRole('button', { name: 'Add evidence' })).toHaveCount(0)
  await expect(owner.page.getByText(/This incident is closed/)).toBeVisible()
  await snap(owner.page, '05-closed-read-only')
  expect(await actionAs(owner.page, 'createEvidence', {
    incidentId, title: 'x', description: 'x', type: 'Log',
  })).toMatchObject({ success: false, code: 'incident_closed' })
  expect(await actionAs(owner.page, 'updateIncident', { incidentId, title: 'Renamed while closed' }))
    .toMatchObject({ success: false, code: 'incident_closed' })

  await owner.page.getByRole('tab', { name: 'Overview' }).click()
  await owner.page.getByRole('button', { name: 'Reopen incident' }).click()
  await expect(owner.page.getByRole('button', { name: 'Edit incident' })).toBeVisible({ timeout: 15_000 })
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  await expect(owner.page.getByRole('button', { name: 'Add evidence' })).toBeVisible()
})
