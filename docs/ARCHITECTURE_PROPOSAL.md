# SignalRoom Revised Architecture Proposal

## 1. Research Basis

Official DeepSpace sources reviewed:

- [DeepSpace SDK overview](https://docs.deep.space/)
- [DeepSpace agent skill](https://raw.githubusercontent.com/deepdotspace/deepspace-skill/main/skills/deepspace/SKILL.md)
- [Architecture](https://docs.deep.space/concepts/architecture.md)
- [Data model](https://docs.deep.space/concepts/data-model.md)
- [Permissions](https://docs.deep.space/concepts/permissions.md)
- [Realtime synchronization](https://docs.deep.space/concepts/realtime-sync.md)
- [Presence and cursors](https://docs.deep.space/guides/presence-and-cursors.md)
- [File uploads](https://docs.deep.space/guides/file-uploads.md)
- [AI chat](https://docs.deep.space/guides/ai-chat.md)
- [Server actions](https://docs.deep.space/guides/server-actions.md)
- [Testing](https://docs.deep.space/guides/testing.md)
- [Deployment](https://docs.deep.space/concepts/deployment.md)
- [Schemas reference](https://docs.deep.space/sdk-reference/worker/schemas.md)
- [Rooms reference](https://docs.deep.space/sdk-reference/worker/rooms.md)
- [Realtime reference](https://docs.deep.space/sdk-reference/client/realtime.md)
- [Worker proxy helpers](https://docs.deep.space/sdk-reference/worker/proxy-helpers.md)

Official examples inspected:

- [Taskspace](https://github.com/deepdotspace/taskspace)
- [Resume](https://github.com/deepdotspace/resume)
- [DeepSpace SDK](https://github.com/deepdotspace/deepspace)

The installed published SDK is `deepspace@0.44.2`. Its `dist/*.d.ts` declarations confirm that `teamField`, `team_members`, `appFiles`, `createDeepSpaceAI`, `verifyJwt`, `usePresenceRoom`, and `RecordRoom` are available exports.

No implementation code or scaffold has been created.

---

## 2. Technology Stack

Unchanged:

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript |
| Styling | Tailwind CSS v4 |
| Routing | Generouted file routing |
| UI primitives | Scaffold shadcn-style components |
| Backend | Hono worker |
| Persistence | DeepSpace RecordRoom + SQLite |
| Authentication | DeepSpace OAuth and JWT |
| Authorization | DeepSpace collection RBAC plus explicit server actions |
| Realtime records | RecordRoom WebSockets |
| Ephemeral presence | DeepSpace `PresenceRoom` |
| Private files | DeepSpace R2, with a verified Worker download path |
| AI | DeepSpace-native AI capabilities, read-only for the MVP |
| Testing | DeepSpace Playwright multi-user fixture |
| Deployment | `npx deepspace deploy` |

No PostgreSQL, Firebase, Supabase, independent authentication, Socket.IO, or independent realtime infrastructure.

---

## 3. RecordRoom Decision

### Selected Architecture

Use **one shared application RecordRoom** containing all incidents and investigation collections.

The room will model incident membership using a native DeepSpace `team_members`-compatible collection:

- `teamId` = incident ID
- `userId` = member user ID
- `status` = `active` or `removed`
- `role` = `Owner`, `Investigator`, or `Viewer`

Each incident-specific collection declares `teamField: 'incidentId'`.

This produces two independent authorization layers:

1. DeepSpace collection RBAC provides row-level read filtering in the Durable Object.
2. Hono server actions provide the custom Owner/Investigator/Viewer operation policy.

The app owner built-in `admin` role does not automatically gain incident access. Domain collections expose reads only to native members who belong to the record's incident team. Writes are disabled on ordinary collection mutations and require server actions.

### Why This Is the Best MVP Choice

- DeepSpace natively supports `read: 'team'`.
- The `team_members` collection is resolved inside the Durable Object.
- Non-members never receive incident records over the RecordRoom WebSocket.
- There is no custom cross-room membership lookup.
- One app room reduces schema, route, DO, reconnect, and test complexity.
- Incident IDs partition records in one room without adding a Durable Object instance per incident.
- Server actions remain the authoritative policy for role-sensitive operations.

### Alternatives Considered

#### Per-incident RecordRoom

Pros:

- Stronger operational isolation between large investigations.
- Independent SQLite state and room subscriptions.

Cons:

- Membership would reside outside the incident room.
- The custom WebSocket route would need to re-query app membership before every room connection.
- Authorization and presence have to be repeated for every room.
- Separate DO and schema registration add implementation and failure surface.
- Cross-room AI, dashboard, and membership queries become more complex.

Per-room isolation is not necessary for this MVP's collection count or operational scale.

#### Collaborators array on every record

Pros:

- Simple schema-level `read: 'shared'` filtering.

Cons:

- Every incident record needs a synchronized member array.
- Membership removal requires updating incident and every child record.
- Role-specific behavior still requires server actions.
- Large or stale collaborator arrays can create authorization drift.

The native team membership model is therefore preferable.

### DO-Level Enforcement

The schema pattern is:

```ts
permissions: {
  '*':     { read: false, create: false, update: false, delete: false },
  viewer:  { read: 'team', create: false, update: false, delete: false },
  member:  { read: 'team', create: false, update: false, delete: false },
  admin:   { read: 'team', create: false, update: false, delete: false },
},
teamField: 'incidentId'
```

DeepSpace resolves team membership inside the RecordRoom and rejects reads outside the membership set before records are broadcast.

`team_members` is internal application state:

- `read: false` for normal users
- `create/update/delete: false` for normal users
- membership changes only through server actions

This prevents clients from forging membership or changing incident roles directly.

No custom role is promoted to a native DeepSpace role. DeepSpace's built-in `viewer/member/admin` roles only control collection operation classes. SignalRoom's `Owner/Investigator/Viewer` policy is stored in `team_members.role` and enforced by server actions.

### Incident Creation Transaction

Incident creation is a privileged server-action workflow, not a direct client write.

1. The action receives `ctx.userId` from verified DeepSpace server-action context. The action must not accept or trust a client-supplied owner ID.
2. Generate one stable incident ID before any write. It is the incident record ID and the team ID:
   - `incidentId = crypto.randomUUID()` or another app-generated ID, but never a value supplied by the caller.
   - The `incidents` record is created with `recordId: incidentId` and `data.incidentId: incidentId`.
3. Create the incident root record with `teamId: incidentId`, `ownerId: ctx.userId`, `status: 'Open'`, and its other validated fields.
4. Create the owner's `team_members` record with `teamId: incidentId`, `userId: ctx.userId`, `role: 'Owner'`, and `status: 'active'`.
5. Child records are created only with `incidentId: incidentId`. There are no child records in the creation transaction, so no child partial state is introduced.

The incident and owner membership are written in a compensating server-action sequence:

```text
Generate incidentId
Create incident root
Create owner membership
Verify both records exist
Return incidentId
```

If owner membership creation fails:

- Remove the incident root.
- Re-check that no membership remains.
- Return the failure to the caller.
- Do not return or redirect to the incident ID.

If rollback itself fails, the incident remains but must fail closed:

- Mark or keep the incident with `status: 'Creating'` and deny reads and writes until a later recovery action finalizes it.
- Run no fallback that exposes it to `team: true` or an app admin merely through schema access.
- Surface the partial state to the owner and log the incident ID for repair.

Normal incident creation uses only two domain collections, but DeepSpace RecordRoom does not provide multi-record cross-collection transactions. This compensating sequence is the transaction boundary: the root and membership must be both present before success, and membership rollback is mandatory on failure.

The incident root cannot act as a team record with `teamId` omitted. It must carry `teamId: incidentId`, and it must also carry `incidentId: incidentId` consistently with child collections. In the selected shared-room model:

- `incidents.incidentId` is the stable incident/team ID.
- `team_members.teamId` equals `incidents.incidentId`.
- Every evidence, timeline, hypothesis, evidence-link, and report row uses `incidentId`.

The incident root permissions use team membership:

```ts
teamField: 'incidentId',
permissions: {
  '*': { read: false, create: false, update: false, delete: false },
  viewer: { read: 'team', create: false, update: false, delete: false },
  member: { read: 'team', create: false, update: false, delete: false },
  admin: { read: 'team', create: false, update: false, delete: false },
}
```

App collaborators and app admins are not incident owners merely because they have an app-level role. The owner membership row is required for incident team access.

### Testing

- Create incident A and incident B.
- Add Alice to A and Bob to B.
- Verify Alice cannot subscribe to or receive B records.
- Verify direct WebSocket/API attempts for B return denied.
- Remove Alice from A and verify reconnection/snapshot does not expose A.
- Promote Alice from Viewer to Investigator and verify mutation authorization changes.
- Verify app-owner `admin` status alone does not grant incident access.

---

## 4. Role and Permission Mapping

DeepSpace built-in roles and SignalRoom incident roles are intentionally separate:

| DeepSpace role | Meaning | SignalRoom mapping |
|---|---|---|
| `viewer` | Native read-only RecordRoom role | May become a SignalRoom Viewer |
| `member` | Normal signed-in app role | Owner, Investigator, or Viewer depending on `team_members.role` |
| `admin` | App admin/owner role | Never grants incident access by itself |

Custom incident roles must not be passed to `useUsers().setRole()` or collection permissions. That API is app-wide and not incident-specific.

### Critical Operation Policy

| Operation | Owner | Investigator | Viewer | Enforcement |
|---|---:|---:|---:|---|
| View incident | Yes | Yes | Yes | DeepSpace `read: 'team'` |
| Add evidence | Yes | Yes | No | Server action |
| Edit evidence | Yes | Yes | No | Server action |
| Delete evidence | Yes | Yes | No | Server action |
| Add/edit timeline event | Yes | Yes | No | Server action |
| Create hypothesis | Yes | Yes | No | Server action |
| Change hypothesis status | Yes | Yes | No | Server action |
| Add evidence link | Yes | Yes | No | Server action |
| Generate proposed report | Yes | Yes | No | Server action |
| Publish/finalize report | Yes | No | No | Server action |
| Close incident | Yes | No | No | Server action |
| Invite member | Yes | No | No | Server action |
| Change/remove member | Yes | No | No | Server action |
| Read AI context/results | Yes | Yes | Yes | Server action, incident membership required |
| Modify evidence through AI | No | No | No | Tool and route denied |

Server actions must:

1. Verify JWT using `verifyJwt`.
2. Resolve the caller's user ID from JWT subject.
3. Load active `team_members` for the incident.
4. Verify membership status.
5. Check the custom role.
6. Validate incident ID and payload.
7. Use action tools only after authorization succeeds.
8. Return a structured denial, not an inferred UI success.

The `team_members.role` column is server-controlled. Server actions, rather than direct writes, are the only accepted membership mutation path.

### Testing

- Signed-out user cannot call protected actions or open incident sockets.
- Viewer receives reads but every mutation action returns denied.
- Investigator can create evidence/hypotheses but cannot invite or close.
- Owner can invite, change roles, close, and publish.
- Removed member loses both direct reads and action access.
- Forged incident/owner fields are rejected or ignored.

---

## 5. File Storage

### Selected MVP Strategy

File attachments should not be a critical day-three dependency.

Use private R2 `scope: "self"` storage for evidence files, with a sidecar evidence record containing:

- `fileKey`
- `originalName`
- `mimeType`
- `size`
- `uploadedBy`
- `incidentId`

When an authorized member requests a file, a server action must:

1. Verify incident membership.
2. Load the evidence record.
3. Verify `evidence.incidentId` matches the requested incident.
4. Determine `evidence.uploadedBy`.
5. Call `appFiles(env, { scope: 'self', userId: evidence.uploadedBy })`.
6. Call `download(evidence.fileKey)` and stream the response only after authorization.

This is supported by the installed SDK: `appFiles` accepts `{ scope: 'self', userId }`, and `download(key)` returns the stored response. The Worker has app identity and can target the uploader's private namespace.

The key security property is that the uploader's private namespace is only traversed after application membership authorization. The Worker must never accept `userId` from client input.

### Verified Limitations

- `APP_IDENTITY_TOKEN` is required, and private R2 local uploads need a prior deployment that provisions it.
- A private file URL is scoped to the signed-in uploader. It cannot be assumed to work directly for another member.
- `appFiles` upload/download requests have platform-specific size limits.
- HTML/SVG/JavaScript execution-oriented file types are refused or served safely.

For this MVP, file storage is optional. Manual evidence, source links, descriptions, and screenshots captured via external source references satisfy the core workflow. The file UI can remain absent or disabled rather than adding public app-scope storage or a custom R2 binding.

### Alternatives Considered

#### `scope: "app"` storage

Rejected for private incident evidence because app-scope reads are world-readable. It is appropriate only for public assets.

#### Independent R2 bucket/custom binding

Rejected for MVP complexity. It would require custom binding declarations and its own access policy while duplicating DeepSpace file storage.

#### Presigned URL/third-party object storage

Rejected because DeepSpace provides a native R2 gateway and these URLs would bypass application membership policy unless independently reconstructed.

### Testing

- Uploader adds a private file.
- Same uploader can download it.
- Another active incident member can download it through the authorized proxy.
- Non-member receives denied before the file gateway call.
- Removed member receives denied.
- Evidence from incident A cannot be requested while operating in incident B.
- Missing file returns a stable application error.

---

## 6. AI Security and Scope

The AI assistant is read-only in the MVP.

It must not use mutation tools for:

- Evidence create/update/delete
- Hypothesis create/update/delete/status change
- Evidence-link create/delete
- Incident status changes
- Report publishing or conclusion updates
- Membership changes

It may:

- Summarize incident records
- Identify supporting evidence
- Identify conflicting evidence
- Detect missing information
- Suggest investigation actions
- Draft report text in memory

All domain mutations remain explicit human actions.

The server must:

1. Verify the caller and incident membership.
2. Load only the incident's records.
3. Build a structured prompt/context object.
4. Disable mutation tools.
5. Stream the native AI response.
6. Parse and validate the response shape.
7. Reject evidence IDs not present in the current incident.
8. Store no AI-generated conclusion as an official status or finding.

The response distinguishes established facts, investigator observations, model hypotheses, missing information, and uncertainty.

### Evidence Validation

Before rendering:

- Evidence IDs must exist in the incident evidence collection.
- Timeline references must exist in the incident timeline.
- No response may add timestamps or investigator names absent from retrieved records.
- Invalid evidence references are removed or cause the entire structured response to be rejected.

Suggested actions may be displayed but not automatically applied.

### Implementation Choice

Use DeepSpace-native AI chat or `createDeepSpaceAI`/`streamDeepSpaceAgent` based on installed scaffold behavior. Do not use the generic built-in tool catalog with mutation tools. If chat feature routes are installed, `ALLOWED_TOOL_NAMES` will contain only read-only or custom context tools, and a server-owned incident context tool is preferable to a generic `records.query` tool.

The exact streaming/response implementation will be finalized against the scaffold package types before coding, not invented in advance.

### Testing

- AI context cannot cross incident boundaries.
- AI cannot invoke evidence/hypothesis mutation tools.
- A response with an evidence ID from another incident is rejected.
- A fabricated evidence ID is rejected.
- A response cannot change a hypothesis status or incident report.
- Human approval is required before a proposed report or hypothesis change is persisted.
- Unauthorized users receive no AI context or response.

---

## 7. Real-Time Collaboration

### Persistent Record Synchronization

Use one app `RecordRoom` and `useQuery`/`useMutations`.

- The DO persists records in SQLite.
- The DO serializes writes.
- Writes broadcast through `core.record_change`.
- The DO applies `team` read permissions before broadcasting.
- Mutations use confirmed variants where navigation or a success message depends on server acceptance.

Ordinary users do not need direct record write permissions because operations are routed through server actions. Server actions can then perform privileged orchestration after custom role checks.

### Ephemeral Presence

Use `usePresenceRoom(\`incident:${incidentId}\`)` or the scaffold's equivalent presence route for per-investigation presence.

Presence is:

- Ephemeral
- In-memory
- Separate from persisted records
- Joined from a verified JWT
- Authorized by a custom Worker membership pre-check

The presence DO may broadcast peer identity and state, but it must not grant incident access. It is reached only after membership verification.

Optionally, `usePresence` may provide approximate persistent online status from `users.lastSeenAt`, but it is not required for the MVP.

### WebSocket Authorization

The Worker must verify the JWT for all protected incident WebSockets. It must then determine whether the JWT subject is an active `team_members` member of the incident represented by the room/scope.

DeepSpace's `wsRoute` verifies JWT identity and strips client-supplied identity fields. Application code adds membership authorization. The presence and RecordRoom sockets must both remain inaccessible to anonymous and non-member users.

The distinction is:

| Responsibility | Primitive |
|---|---|
| Persist/sync domain records | `RecordRoom` |
| Filter record reads | Collection `team` permissions |
| Real-time peer presence | `PresenceRoom` |
| Socket identity | Verified JWT |
| Incident socket membership | Worker membership check plus custom role action policy |
| Custom mutation policy | Hono server actions |

### Testing

- Two users can join the same incident's record and presence scopes.
- Alice's record update appears in Bob's open tab without refresh.
- A user removed from the incident loses next-snapshot access.
- A non-member cannot open the presence or record scope.
- Presence updates do not persist after disconnect.
- Disconnection/reconnect re-subscribe and reconcile.
- Concurrent writes preserve a deterministic server order and do not claim conflict where none exists.

---

## 8. Proposed Project Structure

```text
src/
  pages/
    index.tsx
    (app)/
      _layout.tsx
      (protected)/
        _layout.tsx
        dashboard.tsx
        incidents/
  components/
    shell/
    incident/
    evidence/
    timeline/
    hypotheses/
    analyst/
    report/
  schemas/
    incidents-schema.ts
    team-members-schema.ts
    evidence-schema.ts
    timeline-events-schema.ts
    hypotheses-schema.ts
    evidence-links-schema.ts
    reports-schema.ts
  domain/
    authorization.ts
    incident.ts
    evidence.ts
    hypothesis.ts
    ai-response.ts
  server/
    auth.ts
    incident-authorization.ts
    ai-context.ts
    ai-validation.ts
    file-authorization.ts
  actions/
    index.ts
  ai/
    routes.ts
worker.ts
wrangler.toml
tests/
```

---

## 9. Five-Day Roadmap

Unchanged, with server authorization moved to Day 1:

### Day 1 — Foundation

- Scaffold official DeepSpace app.
- Configure authentication and protected routes.
- Add incident/team-membership schemas.
- Implement server action authorization primitives.
- Build dashboard and incident creation shell.
- Deliverable: authenticated application shell with persistent incidents.

### Day 2 — Core Investigation

- Evidence, timeline, hypotheses, and evidence links.
- Server-side custom role enforcement.
- Team-based read isolation.
- Search and filtering.
- Deliverable: complete single-user investigation workflow.

### Day 3 — Collaboration

- Persistent realtime record synchronization.
- Incident presence.
- Two-user testing.
- Optional private evidence file proxy.
- Deliverable: two users collaborate on authorized incident data.

### Day 4 — AI and Reports

- Read-only incident-context AI.
- Evidence-ID validation.
- Structured findings and uncertainty.
- Human-approved report generation.
- Deliverable: verifiable AI assistance and proposed reports.

### Day 5 — Quality and Deployment

- Authorization and persistence tests.
- Multi-user Playwright tests.
- Responsive pass.
- Production build and deploy.
- Live smoke test and README.
- Deliverable: deployed, verified critical workflow.

---

## 10. Risks and Limitations

Confirmed from documentation and installed SDK types:

- DeepSpace 0.44.2 provides native team-based record permissions.
- Custom incident roles are not native DeepSpace roles.
- Collection RBAC is enforced inside the Durable Object.
- `read: 'team'` requires a `team_members` collection and `teamField`.
- `team_members` membership resolution is available in the same RecordScope.
- Direct record writes should be disabled for every domain collection.
- Server actions bypass collection RBAC and require explicit application checks.
- Private R2 files require `APP_IDENTITY_TOKEN` after deployment.
- The Worker can call `appFiles` with a verified uploader user ID.
- Presence is ephemeral and in-memory.
- Record synchronization is persistent through SQLite.
- AI chat mutation tools are available by default; they must be constrained.
- This environment is not authenticated to DeepSpace, so deployment verification is not currently possible.

Not yet confirmed in implementation:

- Exact scaffold route middleware for adding membership pre-checks to the presence socket.
- Exact native AI chat integration API after scaffolding.
- Exact private-file proxy route shape after scaffold inspection.
- File quota and model availability for the active account.

These items will be verified against installed package types and official examples before implementation.

---

## 11. Final Architecture Tradeoffs

| Choice | Accepted Tradeoff |
|---|---|
| One shared RecordRoom | Less physical isolation, but simpler MVP and native team permissions |
| Native team membership | Custom role values still require server actions |
| Server-action-only writes | More Worker code, but stronger authorization than collection writes |
| Read-only AI | No autonomous investigation mutations, but no AI tool automation in MVP |
| Private file proxy optional | Delays attachments, but avoids a fragile critical dependency |
| Presence separate from records | Simpler ephemeral state, but presence is not persistent |

