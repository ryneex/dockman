import { Dialog } from "@base-ui/react/dialog"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import type { ReactNode } from "react"

import { IconButton } from "@/components/ui/icon-button"
import { motionOrInstant, panel } from "@/lib/motion"

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal>
            <Dialog.Backdrop
              render={
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={motionOrInstant({ duration: 0.16 })}
                  className="fixed inset-0 z-40 bg-black/40"
                />
              }
            />
            <Dialog.Viewport className="fixed inset-0 z-50 flex justify-end">
              <Dialog.Popup
                render={
                  <motion.aside
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={motionOrInstant(panel)}
                    className="border-border bg-elevated flex h-full w-[520px] flex-col border-l outline-none"
                  />
                }
              >
                <header className="border-border flex h-12 items-center justify-between border-b px-4">
                  <Dialog.Title className="tracking-[-0.03em]">{title}</Dialog.Title>
                  <IconButton onClick={onClose} aria-label="Close">
                    <X size={14} />
                  </IconButton>
                </header>
                <div className="min-h-0 flex-1 overflow-auto">{children}</div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
