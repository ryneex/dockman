import { Tooltip } from "@/components/ui/tooltip"
import { hostTcpPort, openPublishedPort } from "@/lib/open-port"

function PortMapping({ mapping }: { mapping: string }) {
  const host = mapping.includes("->") ? hostTcpPort(mapping) : null
  if (!host) {
    return (
      <span className="text-muted min-w-0 truncate font-mono text-sm" title={mapping}>
        {mapping}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="text-muted min-w-0 truncate font-mono text-sm" title={mapping}>
        {mapping}
      </span>
      <button
        type="button"
        className="text-muted hover:text-ink shrink-0 text-sm"
        aria-label={`Open http://127.0.0.1:${host}`}
        onClick={(event) => {
          event.stopPropagation()
          void openPublishedPort(host)
        }}
      >
        Open
      </button>
    </span>
  )
}

export function PortList({ ports }: { ports: string[] }) {
  if (!ports.length) return <span className="text-muted">—</span>

  const [first, ...rest] = ports
  const extra = rest.length

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <PortMapping mapping={first} />
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
