import { Tooltip } from "@/components/ui/tooltip"

export function PortList({ ports }: { ports: string[] }) {
  if (!ports.length) return <span className="text-muted">—</span>

  const [first, ...rest] = ports
  const extra = rest.length

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-muted min-w-0 truncate font-mono text-sm" title={first}>
        {first}
      </span>
      {extra > 0 ? (
        <Tooltip label={ports.join(" · ")}>
          <span className="bg-hover text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
            +{extra}
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}
