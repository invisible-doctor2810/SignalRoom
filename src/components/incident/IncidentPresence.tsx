import { usePresenceRoom } from 'deepspace'
import { incidentPresenceScope } from '@/domain/incident-model'
import { cn } from '@/lib/utils'

/**
 * Who else currently has this incident open. Ephemeral: nothing here is
 * persisted. The socket is admitted only for active members (checked by the
 * Worker); the SDK hook reconnects automatically after a drop.
 */
export function IncidentPresence({
  incidentId,
  currentUserId,
}: {
  incidentId: string
  currentUserId: string | null
}) {
  const { peers, connected } = usePresenceRoom(incidentPresenceScope(incidentId))

  // One entry per person (several tabs share a userId), never yourself.
  const others = [...new Map(peers.map((peer) => [peer.userId, peer])).values()]
    .filter((peer) => peer.userId !== currentUserId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))

  return (
    <section
      aria-label="Active collaborators"
      data-connected={connected ? 'true' : 'false'}
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn('h-2 w-2 rounded-full', connected ? 'bg-success' : 'bg-warning animate-pulse')}
        />
        {connected ? 'Live' : 'Reconnecting…'}
      </span>
      {others.length === 0 ? (
        <span>No other collaborators here</span>
      ) : (
        <>
          <span>Also here:</span>
          <ul className="flex flex-wrap items-center gap-1.5">
            {others.map((peer) => (
              <li
                key={peer.userId}
                data-user-id={peer.userId}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-foreground"
              >
                <span
                  aria-hidden
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
                >
                  {(peer.userName || '?').slice(0, 1).toUpperCase()}
                </span>
                {peer.userName || 'Collaborator'}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
