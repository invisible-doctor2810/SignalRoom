import { useState, type ReactNode } from 'react'
import { Button, ConfirmModal, useToast } from '@/components/ui'

/**
 * A destructive action behind a confirmation dialog. `run` performs the
 * server action; the dialog stays open (with a spinner) until it settles.
 */
export function ConfirmDeleteButton({
  label = 'Delete',
  accessibleName,
  title,
  description,
  confirmText = 'Delete',
  successMessage,
  run,
  trigger,
}: {
  label?: string
  accessibleName: string
  title: string
  description: string
  confirmText?: string
  successMessage: string
  run: () => Promise<unknown>
  trigger?: (open: () => void) => ReactNode
}) {
  const { success, error } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await run()
      success(successMessage)
      setOpen(false)
    } catch (cause) {
      error(`Could not ${confirmText.toLowerCase()}`, cause instanceof Error ? cause.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button size="sm" variant="ghost" aria-label={accessibleName} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      <ConfirmModal
        open={open}
        onClose={() => !busy && setOpen(false)}
        onConfirm={() => void confirm()}
        title={title}
        description={description}
        confirmText={confirmText}
        loading={busy}
      />
    </>
  )
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
