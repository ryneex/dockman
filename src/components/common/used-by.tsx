import { Link } from "react-router-dom"

import { HoverCard } from "@/components/ui/hover-card"
import { StatusDot } from "@/components/ui/status-dot"
import { Tooltip } from "@/components/ui/tooltip"
import type { UsageRef } from "@/lib/types"

export function usageNames(items?: UsageRef[]) {
  return (items ?? []).map((item) => item.name)
}

function UsedByName({ item }: { item: UsageRef }) {
  if (!item.id) {
    return <span className="min-w-0 truncate">{item.name}</span>
  }
  return (
    <Link
      to={`/containers/${item.id}`}
      className="hover:text-ink min-w-0 truncate"
      onClick={(event) => event.stopPropagation()}
    >
      {item.name}
    </Link>
  )
}

function UsedByRow({ item }: { item: UsageRef }) {
  const body = (
    <>
      <StatusDot state={item.state} />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      <span className="text-faint shrink-0 capitalize">{item.state}</span>
    </>
  )
  const className =
    "hover:bg-hover flex w-full min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-left text-sm"
  if (!item.id) {
    return <span className={className}>{body}</span>
  }
  return (
    <Link
      to={`/containers/${item.id}`}
      className={`${className} hover:text-ink`}
      onClick={(event) => event.stopPropagation()}
    >
      {body}
    </Link>
  )
}

export function UsedBy({ items }: { items?: UsageRef[] }) {
  const refs = items ?? []
  if (!refs.length) {
    return <span className="text-muted">Unused</span>
  }

  const [first, ...rest] = refs
  const running = refs.some((item) => item.state === "running" || item.state === "restarting")

  const summary = (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <StatusDot state={running ? "running" : first.state} />
      <UsedByName item={first} />
      {rest.length > 0 ? (
        <span className="bg-hover text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
          +{rest.length}
        </span>
      ) : null}
    </span>
  )

  if (!rest.length) {
    return <Tooltip label={`${first.name} (${first.state})`}>{summary}</Tooltip>
  }

  return (
    <HoverCard
      content={
        <div>
          <p className="text-muted px-1.5 pb-1.5 text-xs">
            Used by {refs.length} container{refs.length === 1 ? "" : "s"}
          </p>
          <ul className="grid">
            {refs.map((item) => (
              <li key={item.id || item.name}>
                <UsedByRow item={item} />
              </li>
            ))}
          </ul>
        </div>
      }
    >
      {summary}
    </HoverCard>
  )
}
