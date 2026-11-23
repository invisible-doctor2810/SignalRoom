import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, ConfirmModal, Modal, useToast } from '@/components/ui'
import {
  ASSIGNABLE_ROLES,
  LIMITS,
  type AssignableRole,
  type IncidentMemberView,
} from '@/domain/incident-model'
import { callAction } from '@/lib/actions'
import { ChoiceField, EmptyPanel, SectionHeader, TextField, pairs } from './fields'
import type { IncidentWorkspace } from './useIncidentWorkspace'

/**
 * Team membership. Member rows are not readable by other members through the
 * RecordRoom (team_members is `read: 'own'`), so the list comes from the
 * membership-checked `listIncidentMembers` action.
 */
export function TeamPanel({ workspace }: { workspace: IncidentWorkspace }) {
  const canManage = workspace.can('members.manage')
  const { success, error } = useToast()
  const [members, setMembers] = useState<IncidentMemberView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<IncidentMemberView | null>(null)
  const [busy, setBusy] = useState(false)
  const { incidentId } = workspace

  const load = useCallback(async () => {
    try {
      const data = await callAction<{ members: IncidentMemberView[] }>('listIncidentMembers', { incidentId })
      setMembers(data.members)
      setLoadError(null)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Failed to load members')
    }
  }, [incidentId])

  // Reload when the caller's own role changes (e.g. after promotion).
  useEffect(() => {
    void load()
  }, [load, workspace.role])

  async function update(member: IncidentMemberView, patch: { role?: AssignableRole; status?: 'active' | 'removed' }) {
    setBusy(true)
    try {
      await callAction('updateIncidentMember', { incidentId, userId: member.userId, ...patch })
      success(patch.status === 'removed' ? 'Member removed' : 'Member updated')
      await load()
    } catch (cause) {
      error('Could not update member', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  const active = members?.filter((member) => member.status === 'active') ?? []
  const removed = members?.filter((member) => member.status !== 'active') ?? []

  return (
    <section aria-label="Team">
      <SectionHeader
        title="Team"
        description="Who can see this incident and what they can change."
        action={canManage ? <Button onClick={() => setAdding(true)}>Add member</Button> : undefined}
      />

      {loadError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Could not load members</p>
          <p className="mt-1 text-muted-foreground">{loadError}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Retry</Button>
        </div>
      ) : members === null ? (
        <p className="text-sm text-muted-foreground">Loading members...</p>
      ) : active.length === 0 ? (
        <EmptyPanel title="No members" description="This incident has no active members." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {active.map((member) => (
            <li
              key={member.userId}
              aria-label={`Member: ${member.name}`}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {member.name}
                  {member.userId === workspace.currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  )}
                </p>
                {member.email && <p className="break-all text-xs text-muted-foreground">{member.email}</p>}
              </div>
              <div className="flex items-center gap-2">
                {canManage && member.role !== 'Owner' ? (
                  <>
                    <div className="w-40">
                      <ChoiceField
                        label={`Role for ${member.name}`}
                        value={member.role}
                        onChange={(role) => void update(member, { role: role as AssignableRole })}
                        options={pairs(ASSIGNABLE_ROLES)}
                      />
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(member)}>
                      Remove
                    </Button>
                  </>
                ) : (
                  <Badge variant={member.role === 'Owner' ? 'default' : 'secondary'}>{member.role}</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && removed.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Removed: {removed.map((member) => member.name).join(', ')}. Add them again to restore access.
        </p>
      )}

      {adding && <AddMemberForm incidentId={incidentId} onClose={() => setAdding(false)} onAdded={load} />}
      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void update(removing, { status: 'removed' })}
        title={`Remove ${removing?.name ?? 'member'}?`}
        description="They immediately lose access to this incident and all of its records."
        confirmText="Remove member"
        loading={busy}
      />
    </section>
  )
}

function AddMemberForm({
  incidentId,
  onClose,
  onAdded,
}: {
  incidentId: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const { success, error } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('Investigator')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!email.trim()) {
      error('Missing information', 'Enter the email address of a SignalRoom user.')
      return
    }
    setSaving(true)
    try {
      await callAction('addIncidentMember', { incidentId, email, role })
      success('Member added', `${email} was added as ${role}.`)
      await onAdded()
      onClose()
    } catch (cause) {
      error('Could not add member', cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} aria-label="Add member">
      <div className="space-y-4 p-1">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Add member</h2>
          <p className="text-sm text-muted-foreground">The person must have signed in to SignalRoom at least once.</p>
        </div>
        <TextField label="Email" type="email" value={email} onChange={setEmail} maxLength={LIMITS.email} />
        <ChoiceField
          label="Role"
          value={role}
          onChange={(value) => setRole(value as AssignableRole)}
          options={pairs(ASSIGNABLE_ROLES)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Adding...' : 'Add member'}</Button>
        </div>
      </div>
    </Modal>
  )
}
