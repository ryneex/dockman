import { Popover } from "@base-ui/react/popover"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function ComboboxPopup({
  open,
  onDismiss,
  children,
  popup,
  className,
}: {
  open: boolean
  onDismiss: () => void
  children: ReactNode
  popup: ReactNode
  className?: string
}) {
  return (
    <Popover.Root
      open={open}
      modal={false}
      onOpenChange={(next, details) => {
        if (next) return
        if (details.reason === "trigger-press") return
        onDismiss()
      }}
    >
      <Popover.Trigger nativeButton={false} render={<div className="w-full min-w-0" />}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[60] outline-none"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            className={cn(
              "border-border bg-elevated w-[var(--anchor-width)] overflow-hidden rounded-[10px] border shadow-2xl shadow-black/50 outline-none",
              className,
            )}
          >
            {popup}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
