import { StatusDot } from "@/components/ui/status-dot"
import { Tooltip } from "@/components/ui/tooltip"
import type { UsageRef } from "@/lib/types"

export function usageNames(items?: UsageRef[]) {
  return (items ?? []).map((item) => item.name)
}

export function UsedBy({ items }: { items?: UsageRef[] }) {
  const refs = items ?? []
  if (!refs.length) {
    return <span className="text-muted">Unused</span>
  }

  const [first, ...rest] = refs
  const running = refs.some((item) => item.state === "running" || item.state === "restarting")

  return (
    <Tooltip label={refs.map((item) => `${item.name} (${item.state})`).join(" · ")}>
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <StatusDot state={running ? "running" : "paused"} />
        <span className="min-w-0 truncate">{first.name}</span>
        {rest.length > 0 ? (
          <span className="bg-hover text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
            +{rest.length}
          </span>
        ) : null}
      </span>
    </Tooltip>
  )
}
