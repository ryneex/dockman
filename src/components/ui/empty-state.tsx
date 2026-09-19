import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void; icon?: LucideIcon }
}) {
  const Icon = action?.icon
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-ink tracking-[-0.03em]">{title}</p>
      <p className="text-muted max-w-md text-sm">{body}</p>
      {action ? (
        <div className="mt-2">
          <Button
            variant="primary"
            icon={Icon ? <Icon strokeWidth={2} /> : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-auto">{children}</div>
}
