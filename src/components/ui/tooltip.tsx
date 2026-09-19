import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import type { ReactNode } from "react"

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={250}>{children}</BaseTooltip.Provider>
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={<span className="inline-flex" />}>
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6}>
          <BaseTooltip.Popup className="border-border bg-elevated text-ink rounded-[8px] border px-2 py-1 text-sm shadow-lg shadow-black/40">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
