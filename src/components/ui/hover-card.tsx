import { PreviewCard } from "@base-ui/react/preview-card"
import type { ReactNode } from "react"

export function HoverCard({ children, content }: { children: ReactNode; content: ReactNode }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={250}
        closeDelay={200}
        render={<span className="inline-flex max-w-full min-w-0" />}
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" align="start" sideOffset={6}>
          <PreviewCard.Popup className="border-border bg-elevated text-ink z-50 max-h-72 w-64 overflow-auto rounded-[10px] border p-2 shadow-lg shadow-black/40">
            {content}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}
