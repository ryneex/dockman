import { Dialog } from "@base-ui/react/dialog"
import { motion } from "framer-motion"
import { Loader2, X } from "lucide-react"
import type { ChangeEvent, ReactElement, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { motionOrInstant, panel } from "@/lib/motion"
import { cn } from "@/lib/utils"

export function FormDialog({
  open,
  title,
  description,
  confirmLabel = "Create",
  pendingLabel = "Working…",
  confirmIcon,
  pending,
  error,
  wide,
  compact,
  trigger,
  aside,
  onSubmit,
  onOpenChange,
  children,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  pendingLabel?: string
  confirmIcon?: ReactNode
  pending?: boolean
  error?: string | null
  wide?: boolean
  compact?: boolean
  trigger?: ReactElement
  aside?: ReactNode
  onSubmit: (event: ChangeEvent) => void
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  function handleSubmit(event: ChangeEvent) {
    if (pending) {
      event.preventDefault()
      return
    }
    onSubmit(event)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return
        onOpenChange(next)
      }}
    >
      {trigger ? <Dialog.Trigger render={trigger} /> : null}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-6">
          <Dialog.Popup
            render={
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={motionOrInstant(panel)}
                className={cn(
                  "border-border bg-elevated flex max-h-[calc(100dvh-3rem)] flex-col overflow-y-auto rounded-[12px] border px-8 py-7 shadow-2xl shadow-black/50 outline-none",
                  compact ? null : "min-h-80",
                  wide
                    ? "w-[min(var(--container-dialog-wide),calc(100vw-3rem))]"
                    : "w-[min(var(--container-dialog),calc(100vw-3rem))]",
                )}
              />
            }
          >
            <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <Dialog.Title className="tracking-[-0.03em]">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-muted mt-2 text-sm">
                  {description}
                </Dialog.Description>
              ) : null}
              <div className="mt-5 grid flex-1 content-start gap-4">{children}</div>
              {error ? <p className="text-exited mt-3 text-sm">{error}</p> : null}
              <div className="mt-6 flex items-center justify-end gap-2">
                {aside ? <div className="mr-auto">{aside}</div> : null}
                <Button
                  type="button"
                  icon={<X />}
                  disabled={pending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  icon={pending ? <Loader2 className="animate-spin" /> : confirmIcon}
                  disabled={pending}
                >
                  {pending ? pendingLabel : confirmLabel}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
