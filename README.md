# SignalRoom

**A collaborative incident investigation workspace built on DeepSpace.**

When a production incident happens, the facts end up scattered across logs, chat
threads, screenshots and people's heads. SignalRoom gives each incident one
shared, access-controlled workspace where a team collects evidence, rebuilds a
timeline, weighs competing hypotheses against that evidence, sees who else is
investigating in real time, asks an AI analyst that only answers from the
incident's own records, and produces a resolution report.

---

## What it does

| Area | What you can do |
|---|---|
| Incidents | Create incidents (title, description, category, severity, time). Dashboard with search, status filter and counts. |
| Workspace | Per-incident page with **Overview, Evidence, Timeline, Hypotheses, AI Analyst, Report, Team** tabs. |
| Evidence | Add / edit / delete evidence with type, source, verification status (Unverified · Verified · Disputed) and creator attribution. Search. |
| Timeline | Chronological events with timestamps, optional link to evidence, "important" highlighting, recorder attribution. Add / edit / delete. |
| Hypotheses | Competing explanations with status (Proposed · Under Investigation · Supported · Rejected · Inconclusive). Link evidence as **Supports / Contradicts / Neutral**. |
| Team | Owner adds members by email as Investigator or Viewer, changes roles, removes members. |
| Real-time | Every change appears in other members' open tabs without refresh; incident-scoped presence shows who else is in the incident. |
| AI Analyst | Structured analysis of the incident (summary, established facts, possible explanations, supporting / contradicting evidence, missing information, next steps, uncertainty) with **validated evidence citations**. |
| Report | Nine-section resolution report generated from the records; **Export Markdown**. |

### Roles

| Operation | Owner | Investigator | Viewer |
|---|:-:|:-:|:-:|
| View incident, records, presence, AI analysis, report | ✓ | ✓ | ✓ |
| Create / edit / delete evidence, timeline, hypotheses, links | ✓ | ✓ | – |
| Edit incident, change status, reopen | ✓ | – | – |
| Add / change / remove members | ✓ | – | – |

**Closed incidents are read-only for everyone.** Only the Owner can reopen one
(a status-only change). The Owner can still remove members from a closed
incident so access can always be revoked.

---

## Architecture

```
Browser (React 19, React Router, Tailwind)              Cloudflare Worker (Hono)                     Durable Objects
──────────────────────────────────────────              ──────────────────────────                    ───────────────
useQuery(...) ◄──── live record sync (WebSocket) ─────► /ws/:room ──────────────────────────────────► AppRecordRoom (SQLite)
                                                                                                        • collection RBAC
callAction('createEvidence', …) ── HTTPS + JWT ───────► /api/actions/:name                              • read: 'team' via team_members
                                                        • verify JWT → ctx.userId
                                                        • requireIncidentAccess()  ── RBAC-off tools ──► (writes)
                                                        • analyzeIncident → DeepSpace AI proxy (Claude)
usePresenceRoom('incident:<id>') ── WebSocket + JWT ──► /ws/presence/:scope
                                                        • verify JWT + active membership ─────────────► AppPresenceRoom (one per incident)
```

**Source layout**

| Path | Responsibility |
|---|---|
| `src/domain/` | Pure, unit-tested core: vocabulary (`incident-model.ts`), role policy (`authorization.ts`), input validation, AI contract + citation validator (`ai-analysis.ts`), report builder (`resolution-report.ts`). |
| `src/schemas/` | DeepSpace collection schemas and their row-level permissions. |
| `src/server/incident-access.ts` | The single authorization gate every incident action uses. |
| `src/server/incident-presence.ts` | Presence-socket authorization and eviction. |
| `src/server/realtime-routes.ts` | WebSocket routes (record room, incident presence). |
| `src/actions/` | Server actions — the **only** write path for incident data. |
| `src/components/incident/` | Workspace UI panels. |
| `src/pages/(app)/(protected)/incidents/[incidentId].tsx` | Workspace route. |
| `worker.ts` | Worker assembly, Durable Object classes (incl. the presence eviction route). |

### Data model

All incident-scoped collections carry `incidentId` and declare
`teamField: 'incidentId'`.

| Collection | Key fields |
|---|---|
| `incidents` | incidentId, title, description, category, severity, status, ownerId, initialTimestamp |
| `team_members` | teamId (= incidentId), userId, role (Owner/Investigator/Viewer), status (active/removed) |
| `evidence` | title, description, type, source, verificationStatus (+ system `createdBy`, `createdAt`) |
| `timeline_events` | title, description, occurredAt, sourceEvidenceId (optional), important |
| `hypotheses` | title, explanation, status |
| `evidence_links` | evidenceId, hypothesisId, relationship (one per pair) |

Creator attribution uses DeepSpace's system `createdBy`, stamped from the
verified caller, so it cannot be forged.

---

## DeepSpace capabilities used, and why

| Capability | Used for | Why this primitive |
|---|---|---|
| **RecordRoom** (Durable Object + SQLite) | All persistent incident data in one app room | Persistence, serialized writes and live sync come built in; one room keeps cross-incident dashboard queries simple. |
| **Collection RBAC, `read: 'team'` + `team_members`** | Row-level read isolation per incident | Resolved inside the Durable Object before records are broadcast, so non-members never receive another incident's rows. A per-incident room or collaborator arrays were rejected (more routing, membership drift). |
| **`useQuery`** | Live UI | Subscribed queries update every open tab without polling. |
| **Server actions** (`/api/actions/:name`) | Every mutation | Custom Owner/Investigator/Viewer policy, cross-record validation and dependent-record cleanup need server code. Direct collection writes are disabled for every role. |
| **PresenceRoom + `usePresenceRoom`** | "Who's here" per incident | Ephemeral, in-memory, auto-reconnecting presence with no custom socket code. |
| **DeepSpace auth (JWT)** | Identity everywhere | Actions and sockets use only the verified JWT subject. |
| **`createDeepSpaceAI`** (AI proxy) + `ai` SDK `generateText` | AI analyst | DeepSpace-native model access (Claude), billed to the calling user; no external AI dependency or API key in the app. |
| **DeepSpace testing** (`deepspace/testing` multi-user fixtures) | Two-user browser tests | Real accounts in separate browser contexts. |

---

## Security and authorization

* **Identity:** only the verified JWT subject (`ctx.userId`) is trusted. Client-supplied user ids, owner ids and `createdBy` are ignored.
* **Reads:** enforced by the RecordRoom (`read: 'team'`). Removed members (`status: 'removed'`) are excluded immediately.
* **Writes:** every action calls `requireIncidentAccess(tools, userId, incidentId, operation)`, which checks the incident exists (and is not in the internal `Creating` state), the caller has an **active** membership row, and the role allows the operation. Action tools bypass record RBAC, so this check is mandatory and centralized.
* **Cross-incident protection:** every referenced evidence / hypothesis / link / timeline id is loaded and must belong to the same incident; otherwise the response is `not_found` (same as a missing record — ids cannot be probed). Cleanup queries always include `incidentId`.
* **Closed incidents:** investigation writes and deletes return `incident_closed` for every role; only the Owner's status-only reopen is accepted.
* **Deletion integrity:** dependents are cleaned first — deleting evidence removes its hypothesis links and clears timeline citations; deleting a hypothesis removes its links. All destructive UI actions require confirmation.
* **Presence:** `/ws/presence/:scope` only accepts `incident:<id>` scopes, and only after JWT verification and the same membership check (anonymous → 401, non-member/removed → 403, other scopes → 404). Removing a member closes their live presence sockets (close code 4403) via an internal Durable Object route reachable only from the Worker. Peers see only a user id and display name — no emails.
* **Member emails** are shown only to the incident Owner.
* **AI:** see below — scoped context, no write access, validated citations.
* **Secrets** live in `.dev.vars` locally (git-ignored) and DeepSpace secrets in production; nothing secret is in the frontend bundle.

---

## AI investigation workflow

1. An incident member opens **AI Analyst** and picks a suggested question or asks their own.
2. The `analyzeIncident` action verifies membership, then loads **only that incident's** evidence, timeline, hypotheses and evidence links (rows are re-filtered by `incidentId`).
3. The model (Claude via `createDeepSpaceAI`, billed to the caller) receives that structured JSON and a system prompt requiring a JSON answer with `summary, establishedFacts, hypotheses, supportingEvidence, contradictingEvidence, missingInformation, recommendedActions, uncertainty`, citing evidence only by the provided ids.
4. `validateAnalysis` checks **every** cited evidence id against the incident's real evidence ids. Unknown or foreign ids are removed and counted in `rejectedReferences`; an "established fact" left without a valid citation is dropped.
5. The panel separates **Evidence-backed** facts from **Suggestion · needs review** items and **Unknown** information. Answers are not saved and the analyst has no write path — a suggestion becomes official only when a human records it as evidence or changes a hypothesis status.
6. Model failure or unreadable output returns a handled error (`ai_payment_required` when the caller has no DeepSpace AI credits, `ai_unavailable`, `ai_invalid_response`).

> **Verification status:** the analyst's scoping, citation validation and error handling are covered by unit tests and a browser test. In local browser testing the DeepSpace AI proxy answered `402 Payment Required` for the test account, so a live model answer has not yet been observed end-to-end; the UI showed the handled error.

The **resolution report** is deliberately *not* AI-generated: it is built from the persisted, human-reviewed records, so its "Established findings" contain only Verified evidence and Supported hypotheses, and everything else is listed under "Unresolved questions".

---

## Running locally

**Prerequisites:** Node 22.15+/24/26 and npm ≥ 11.6 (see `package.json` engines), a DeepSpace account.

```bash
npm ci                          # clean, lockfile-exact install
npx deepspace auth login        # browser sign-in to DeepSpace
npx deepspace dev start         # local dev server (Vite + Miniflare/workerd) at http://localhost:5173
```

`deepspace dev start` writes the local `.dev.vars` file for you.

### Environment variables

Local values live in `.dev.vars` (git-ignored, generated by the DeepSpace CLI); in production they are set by `npx deepspace deploy` / `npx deepspace secrets`. Never commit them.

| Variable | Purpose |
|---|---|
| `DEEPSPACE_APP_ID` | Immutable app identity (in `wrangler.toml`). |
| `APP_NAME` | Display name (in `wrangler.toml`). |
| `AUTH_JWT_PUBLIC_KEY`, `AUTH_JWT_ISSUER` | Verify user JWTs in actions and WebSocket routes. |
| `AUTH_WORKER_URL`, `API_WORKER_URL`, `PLATFORM_WORKER_URL` | DeepSpace platform endpoints (local dev fallbacks for service bindings). |
| `OWNER_USER_ID` | App owner's user id. |
| `APP_OWNER_JWT` | Owner-scoped token for developer-billed platform calls. |
| `APP_IDENTITY_TOKEN` | App credential minted on first deploy. |
| `ALLOW_DEBUG_ROUTES` | Enables owner-only debug routes when exactly `true` (local/test only). |
| `NATIVE_AUTH_REDIRECT_URIS` | Optional native-app auth callbacks (unused by SignalRoom). |
| `SIGNALROOM_WEBSERVER_TIMEOUT_MS` | *Test-only, optional.* Playwright dev-server start timeout (default 60000). |

No separate AI API key is needed — the AI analyst uses the DeepSpace AI proxy.

---

## Testing

```bash
npm run build          # production build
npm run type-check     # tsc --noEmit
npm run lint           # eslint
npm run test:unit      # Vitest: domain + server actions (in-memory fake of the action tools)
npx deepspace test run all   # unit + Playwright (needs two DeepSpace test accounts)
```

Browser tests need two test accounts named **SignalRoom Owner** and **SignalRoom Investigator**
(`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`).
On a memory-constrained machine: `SIGNALROOM_WEBSERVER_TIMEOUT_MS=240000 npx deepspace test run all`.

| Suite | Covers |
|---|---|
| `src/actions/incident-workspace.test.ts` | Role table, viewer/outsider/removed denials, cross-incident references, attribution, member management, closed-incident policy. |
| `src/actions/collaboration.test.ts` | Presence authorization & isolation, eviction on removal, deletion + relationship cleanup, viewer/closed/cross-incident deletion denial. |
| `src/actions/analyst.test.ts` | AI context scoped to one incident, invented/foreign citations rejected, non-members denied before any model call, error handling, no writes. |
| `src/domain/resolution-report.test.ts` | Nine sections, confirmed vs unresolved separation, chronology, no false root cause. |
| `tests/incident-workspace.spec.ts` | Two-user browser flow: create → evidence → timeline → hypotheses/links → Viewer read-only → Investigator writes (live) → cross-incident rejection → removal → closed/reopen. |
| `tests/incident-collaboration.spec.ts` | Presence (same incident, isolation, unauthorized sockets, offline/online reconnect, server eviction with code 4403) and confirmed deletions with cleanup. |
| `tests/incident-ai-report.spec.ts` | AI Analyst and Report tabs in the browser; report export. |
| `tests/collab.spec.ts`, `smoke.spec.ts`, `api.spec.ts` | Incident isolation, auth, scaffold smoke/API checks. |

---

## Known limitations

* **Concurrent edits are last-write-wins.** Writes are serialized by the Durable Object, but two people editing the same record at once are not warned of a conflict.
* **No file attachments.** Evidence is text with a `source` reference. Team-scoped private file sharing needs a membership-checked proxy over DeepSpace file storage; it was deliberately excluded.
* **Reports are not persisted.** The report is regenerated from live records on demand and exported as Markdown (no PDF).
* **AI answers are not saved** and depend on DeepSpace AI availability/credits for the calling user (billed to the caller). Without credits the analyst shows a clear "needs AI credits" error.
* **Record socket:** the shared app RecordRoom accepts any signed-in user's connection; incident isolation is enforced by `read: 'team'` row filtering rather than by refusing the socket.
* **Members are added by email** and must have signed in once; this also reveals to an Owner whether an email has a SignalRoom account.
* **Presence scopes other than `incident:<id>` are disabled** (the scaffold's generic presence route was locked down).

## Deliberately excluded

File uploads, PDF export, persisted AI chat history, AI write access to records, ownership transfer, notifications, and per-incident Durable Objects.

## Future improvements

Optimistic-concurrency version checks with conflict UI; membership-checked private evidence files; persisted, versioned reports with PDF export; saving reviewed AI findings as evidence/hypotheses with provenance; audit log of membership and status changes; live "who is editing this record" indicators.

---

## Deployment

* **Live app:** https://signalroom-incidents.app.space
* **Source:** https://github.com/invisible-doctor2810/SignalRoom (private). The DeepSpace app's source authority is this GitHub repository; `npx deepspace deploy` ships the checked-out working tree.

**Production verification (2026-11-23):** HTTP 200 for `/`, `/dashboard` and `/api/auth/ok`, and these browser specs passed against the live URL with two real accounts (`tests/playwright.prod.config.ts`): `incident-workspace`, `incident-collaboration` (presence incl. server eviction, deletion) and `incident-ai-report` (report + export, AI scoping). In production the AI analyst returned the handled **"needs DeepSpace AI credits"** error (`402` from the DeepSpace AI proxy for the test account); a live model answer has **not** yet been observed.

```bash
SIGNALROOM_BASE_URL=https://signalroom-incidents.app.space \
  npx playwright test -c tests/playwright.prod.config.ts tests/incident-workspace.spec.ts
```

Production runs create `__test-…` records in the live database.
