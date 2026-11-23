/**
 * Day 3 — incident-scoped presence and record deletion, with two real users.
 *
 * Presence is checked twice: through the UI ("Active collaborators") and with
 * raw WebSockets against /ws/presence/:scope, so the Worker's membership
 * gate and the server-side eviction are verified directly, not inferred.
 */
import type { Locator, Page } from '@playwright/test'
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

/** Opens a raw presence socket; resolves 'open' or 'rejected'. Closes it unless `keep`. */
async function probePresence(
  page: Page,
  scope: string,
  options: { withToken?: boolean; keep?: boolean } = {},
): Promise<'open' | 'rejected'> {
  return page.evaluate(async ({ scope, withToken, keep }) => {
    let token = ''
    if (withToken) {
      const response = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
      token = ((await response.json()) as { token?: string }).token ?? ''
    }
    const url = new URL(`/ws/presence/${encodeURIComponent(scope)}`, location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (token) url.searchParams.set('token', token)
    return new Promise<'open' | 'rejected'>((resolve) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => { ws.close(); resolve('rejected') }, 15_000)
      ws.onopen = () => {
        clearTimeout(timer)
        if (keep) {
          const w = window as unknown as { __probe?: { ws: WebSocket; closed: Promise<number> } }
          w.__probe = { ws, closed: new Promise((done) => { ws.onclose = (event) => done(event.code) }) }
        } else {
          ws.close()
        }
        resolve('open')
      }
      ws.onerror = () => { clearTimeout(timer); resolve('rejected') }
      ws.onclose = () => { clearTimeout(timer); resolve('rejected') }
    })
  }, { scope, withToken: options.withToken ?? true, keep: options.keep ?? false })
}

function collaborators(page: Page): Locator {
  return page.getByRole('region', { name: 'Active collaborators' })
}

function peer(page: Page, userId: string): Locator {
  return collaborators(page).locator(`[data-user-id="${userId}"]`)
}

async function setupIncident(owner: Page, title: string) {
  const { incidentId } = await data<{ incidentId: string }>(owner, 'createIncident', {
    title, description: 'Day 3 collaboration test', category: 'Testing', severity: 'Low',
    initialTimestamp: new Date().toISOString(),
  })
  return incidentId
}

async function memberIds(owner: Page, incidentId: string, memberEmail: string) {
  const { members } = await data<{ members: Array<{ userId: string; role: string; email?: string }> }>(
    owner, 'listIncidentMembers', { incidentId },
  )
  const ownerId = members.find((m) => m.role === 'Owner')!.userId
  const memberId = members.find((m) => m.email?.toLowerCase() === memberEmail.toLowerCase())!.userId
  return { ownerId, memberId }
}

test('incident presence is member-only, isolated per incident, reconnects and is revoked on removal', async ({ users }) => {
  test.setTimeout(180_000)
  const [owner, member] = await users(['SignalRoom Owner', 'SignalRoom Investigator'])
  const stamp = Date.now()
  await owner.page.goto('/dashboard')
  await member.page.goto('/dashboard')

  const incidentA = await setupIncident(owner.page, `__test-${stamp}__ Presence A`)
  await data(owner.page, 'addIncidentMember', { incidentId: incidentA, email: member.email, role: 'Investigator' })
  const { ownerId, memberId } = await memberIds(owner.page, incidentA, member.email)
  const incidentB = await setupIncident(member.page, `__test-${stamp}__ Presence B`)

  // ── Unauthorized connections are refused by the Worker ─────────────────
  expect(await probePresence(owner.page, `incident:${incidentA}`, { withToken: false })).toBe('rejected')
  expect(await probePresence(owner.page, `incident:${incidentB}`)).toBe('rejected')
  expect(await probePresence(owner.page, 'canvas:anything')).toBe('rejected')
  expect(await probePresence(owner.page, `incident:${incidentA}`)).toBe('open')

  // ── Two investigators in the same incident see each other ──────────────
  await owner.page.goto(`/incidents/${incidentA}`)
  await member.page.goto(`/incidents/${incidentA}`)
  await expect(collaborators(owner.page)).toHaveAttribute('data-connected', 'true', { timeout: 15_000 })
  await expect(peer(owner.page, memberId)).toBeVisible({ timeout: 15_000 })
  await expect(peer(member.page, ownerId)).toBeVisible({ timeout: 15_000 })
  await expect(peer(owner.page, ownerId)).toHaveCount(0) // never yourself
  await owner.page.screenshot({ path: '.deepspace/screenshots/day3-01-presence-two-users.png', fullPage: true })

  // ── Different incidents never share presence ───────────────────────────
  await member.page.goto(`/incidents/${incidentB}`)
  await expect(peer(owner.page, memberId)).toHaveCount(0, { timeout: 15_000 })
  await expect(collaborators(member.page)).toContainText('No other collaborators here', { timeout: 15_000 })
  await expect(peer(member.page, ownerId)).toHaveCount(0)

  // ── Disconnect and reconnect ────────────────────────────────────────────
  await member.page.goto(`/incidents/${incidentA}`)
  await expect(peer(owner.page, memberId)).toBeVisible({ timeout: 15_000 })
  await member.context.setOffline(true)
  await expect(collaborators(member.page)).toHaveAttribute('data-connected', 'false', { timeout: 15_000 })
  await expect(peer(owner.page, memberId)).toHaveCount(0, { timeout: 15_000 })
  await member.context.setOffline(false)
  await expect(collaborators(member.page)).toHaveAttribute('data-connected', 'true', { timeout: 20_000 })
  await expect(peer(owner.page, memberId)).toBeVisible({ timeout: 20_000 })
  await expect(peer(member.page, ownerId)).toBeVisible({ timeout: 20_000 })

  // ── Removal revokes presence server-side, even for a socket left open ──
  expect(await probePresence(member.page, `incident:${incidentA}`, { keep: true })).toBe('open')
  await data(owner.page, 'updateIncidentMember', { incidentId: incidentA, userId: memberId, status: 'removed' })
  const closeCode = await member.page.evaluate(() =>
    (window as unknown as { __probe: { closed: Promise<number> } }).__probe.closed,
  )
  expect(closeCode).toBe(4403)
  await expect(peer(owner.page, memberId)).toHaveCount(0, { timeout: 15_000 })
  expect(await probePresence(member.page, `incident:${incidentA}`)).toBe('rejected')
  await member.page.reload()
  await expect(member.page.getByText('Incident not available')).toBeVisible({ timeout: 15_000 })
})

test('record deletion is confirmed, role- and status-checked, incident-scoped, and cleans up relationships', async ({ users }) => {
  test.setTimeout(180_000)
  const [owner, member] = await users(['SignalRoom Owner', 'SignalRoom Investigator'])
  const stamp = Date.now()
  const t = (name: string) => `__test-${stamp}__ ${name}`
  await owner.page.goto('/dashboard')
  await member.page.goto('/dashboard')

  const incidentId = await setupIncident(owner.page, t('Deletion'))
  await data(owner.page, 'addIncidentMember', { incidentId, email: member.email, role: 'Viewer' })

  const { evidenceId } = await data<{ evidenceId: string }>(owner.page, 'createEvidence', {
    incidentId, title: t('Pool graph'), description: 'Pool at 100%', type: 'Metric',
  })
  const { evidenceId: secondEvidenceId } = await data<{ evidenceId: string }>(owner.page, 'createEvidence', {
    incidentId, title: t('Error log'), description: '503s', type: 'Log',
  })
  const { hypothesisId } = await data<{ hypothesisId: string }>(owner.page, 'createHypothesis', {
    incidentId, title: t('Pool exhaustion'), explanation: 'Too many connections',
  })
  const { timelineEventId } = await data<{ timelineEventId: string }>(owner.page, 'createTimelineEvent', {
    incidentId, title: t('Saturation'), occurredAt: new Date().toISOString(), sourceEvidenceId: evidenceId,
  })
  await data(owner.page, 'setEvidenceLink', { incidentId, evidenceId, hypothesisId, relationship: 'Supports' })
  await data(owner.page, 'setEvidenceLink', { incidentId, evidenceId: secondEvidenceId, hypothesisId, relationship: 'Contradicts' })

  // ── Viewer: no delete controls, and every delete is refused ────────────
  await member.page.goto(`/incidents/${incidentId}`)
  await member.page.getByRole('tab', { name: /Evidence/ }).click()
  await expect(member.page.getByRole('article', { name: `Evidence: ${t('Pool graph')}` })).toBeVisible({ timeout: 15_000 })
  await expect(member.page.getByRole('button', { name: /^Delete / })).toHaveCount(0)
  for (const [name, ids] of [
    ['deleteEvidence', { evidenceId }],
    ['deleteHypothesis', { hypothesisId }],
    ['deleteTimelineEvent', { timelineEventId }],
    ['removeEvidenceLink', { evidenceId, hypothesisId }],
  ] as const) {
    expect(await actionAs(member.page, name, { incidentId, ...ids })).toMatchObject({ success: false, code: 'forbidden' })
  }

  // ── Cross-incident: B's records cannot be deleted through A ────────────
  const otherIncident = await setupIncident(member.page, t('Other'))
  const { evidenceId: foreignEvidence } = await data<{ evidenceId: string }>(member.page, 'createEvidence', {
    incidentId: otherIncident, title: t('Foreign'), description: 'x', type: 'Log',
  })
  expect(await actionAs(owner.page, 'deleteEvidence', { incidentId, evidenceId: foreignEvidence }))
    .toMatchObject({ success: false, code: 'not_found' })
  expect(await actionAs(owner.page, 'deleteEvidence', { incidentId: otherIncident, evidenceId: foreignEvidence }))
    .toMatchObject({ success: false, code: 'not_found' })
  expect(await actionAs(member.page, 'updateEvidence', { incidentId: otherIncident, evidenceId: foreignEvidence, title: t('Foreign still here') }))
    .toMatchObject({ success: true })

  // ── Owner deletes evidence through the confirmation dialog ─────────────
  await owner.page.goto(`/incidents/${incidentId}`)
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  await owner.page.getByRole('button', { name: `Delete evidence ${t('Pool graph')}` }).click()
  const dialog = owner.page.getByRole('dialog')
  await expect(dialog).toContainText('1 hypothesis link')
  await expect(dialog).toContainText('1 timeline event')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(owner.page.getByRole('article', { name: `Evidence: ${t('Pool graph')}` })).toBeVisible()
  await owner.page.getByRole('button', { name: `Delete evidence ${t('Pool graph')}` }).click()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(owner.page.getByRole('article', { name: `Evidence: ${t('Pool graph')}` })).toHaveCount(0, { timeout: 15_000 })
  // Realtime: the Viewer's open tab loses it too.
  await expect(member.page.getByRole('article', { name: `Evidence: ${t('Pool graph')}` })).toHaveCount(0, { timeout: 15_000 })
  // Relationship cleanup: link gone, timeline event kept without its citation.
  await owner.page.getByRole('tab', { name: /Hypotheses/ }).click()
  const hypothesisCard = owner.page.getByRole('article', { name: `Hypothesis: ${t('Pool exhaustion')}` })
  await expect(hypothesisCard.getByText('Supporting (0)')).toBeVisible({ timeout: 15_000 })
  await expect(hypothesisCard.getByText('Contradicting (1)')).toBeVisible()
  await owner.page.getByRole('tab', { name: /Timeline/ }).click()
  const eventCard = owner.page.getByRole('article', { name: `Timeline event: ${t('Saturation')}` })
  await expect(eventCard).toBeVisible()
  await expect(eventCard.getByText(/Evidence:/)).toHaveCount(0)

  // ── Unlink through confirmation ────────────────────────────────────────
  await owner.page.getByRole('tab', { name: /Hypotheses/ }).click()
  await hypothesisCard.getByRole('button', { name: `Unlink ${t('Error log')}` }).click()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Unlink' }).click()
  await expect(hypothesisCard.getByText('Contradicting (0)')).toBeVisible({ timeout: 15_000 })
  await owner.page.screenshot({ path: '.deepspace/screenshots/day3-02-after-deletions.png', fullPage: true })

  // ── Closed incident: deletes refused, controls hidden ──────────────────
  await data(owner.page, 'updateIncident', { incidentId, status: 'Closed' })
  await expect(owner.page.getByRole('button', { name: /^Delete / })).toHaveCount(0, { timeout: 15_000 })
  expect(await actionAs(owner.page, 'deleteHypothesis', { incidentId, hypothesisId }))
    .toMatchObject({ success: false, code: 'incident_closed' })
  expect(await actionAs(owner.page, 'deleteTimelineEvent', { incidentId, timelineEventId }))
    .toMatchObject({ success: false, code: 'incident_closed' })
  await data(owner.page, 'updateIncident', { incidentId, status: 'Open' })

  // ── Hypothesis and timeline deletion through the UI ────────────────────
  await data(owner.page, 'setEvidenceLink', { incidentId, evidenceId: secondEvidenceId, hypothesisId, relationship: 'Neutral' })
  await owner.page.getByRole('button', { name: `Delete hypothesis ${t('Pool exhaustion')}` }).click()
  await expect(owner.page.getByRole('dialog')).toContainText('1 evidence link')
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(hypothesisCard).toHaveCount(0, { timeout: 15_000 })
  // The linked evidence survives; its link is gone (re-linking works afresh).
  await owner.page.getByRole('tab', { name: /Evidence/ }).click()
  await expect(owner.page.getByRole('article', { name: `Evidence: ${t('Error log')}` })).toBeVisible()

  await owner.page.getByRole('tab', { name: /Timeline/ }).click()
  await owner.page.getByRole('button', { name: `Delete timeline event ${t('Saturation')}` }).click()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(eventCard).toHaveCount(0, { timeout: 15_000 })
  await expect(owner.page.getByRole('tab', { name: 'Timeline (0)' })).toBeVisible()
})
