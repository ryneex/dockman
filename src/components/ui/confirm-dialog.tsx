import { AlertDialog } from "@base-ui/react/alert-dialog"
import { motion } from "framer-motion"
import { Check, Loader2, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { motionOrInstant, panel } from "@/lib/motion"

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  pending?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-6">
          <AlertDialog.Popup
            render={
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={motionOrInstant(panel)}
                className="border-border bg-elevated w-[400px] rounded-[12px] border p-6 shadow-2xl shadow-black/50 outline-none"
              />
            }
          >
            <AlertDialog.Title className="tracking-[-0.03em]">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-muted mt-2 text-sm">
              {description}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button icon={<X />} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                icon={
                  pending ? <Loader2 className="animate-spin" /> : danger ? <Trash2 /> : <Check />
                }
                disabled={pending}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
