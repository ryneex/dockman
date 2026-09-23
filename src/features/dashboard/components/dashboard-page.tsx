import { Box, Container, HardDrive, Network, RefreshCw } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router-dom"

import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { formatAge, formatBytes, shortId } from "@/lib/format"
import {
  useEngine,
  useEngineEvents,
  useImages,
  useNetworks,
  useSystemDf,
  useVolumes,
} from "@/lib/queries"
import type { DiskUsageKind, EngineEvent } from "@/lib/types"

export function DashboardPage() {
  const engine = useEngine()
  const images = useImages()
  const volumes = useVolumes()
  const networks = useNetworks()
  const df = useSystemDf()
  const events = useEngineEvents()
  const recentEvents = useMemo(
    () => [...(events.data ?? [])].sort((a, b) => b.time - a.time).slice(0, 12),
    [events.data],
  )

  if (engine.isError) {
    return (
      <EmptyState
        title="Cannot reach Docker"
        body={engine.error instanceof Error ? engine.error.message : String(engine.error)}
        action={{ label: "Retry", onClick: () => void engine.refetch(), icon: RefreshCw }}
      />
    )
  }

  if (engine.isLoading || !engine.data) {
    return (
      <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  const info = engine.data
  const cards = [
    {
      label: "Containers",
      value: info.containers_running,
      meta: `${info.containers} total`,
      to: "/containers",
      icon: Container,
    },
    {
      label: "Images",
      value: info.images,
      meta: images.data
        ? `${images.data.filter((row) => row.used_by?.length).length} in use`
        : "local",
      to: "/images",
      icon: Box,
    },
    {
      label: "Volumes",
      value: volumes.data?.length ?? "—",
      meta: volumes.data
        ? `${volumes.data.filter((row) => row.used_by?.length).length} in use`
        : "named",
      to: "/volumes",
      icon: HardDrive,
    },
    {
      label: "Networks",
      value: networks.data?.length ?? "—",
      meta: networks.data
        ? `${networks.data.filter((row) => row.used_by?.length).length} in use`
        : "including defaults",
      to: "/networks",
      icon: Network,
    },
  ]

  return (
    <div className="relative min-h-full overflow-auto p-6">
      <div className="bg-accent/4 pointer-events-none absolute -top-20 -left-16 h-64 w-64 rounded-full blur-3xl" />
      <p className="text-faint text-sm">Engine</p>
      <h1 className="mt-1 tracking-[-0.03em]">{info.name || "Docker"}</h1>
      <p className="text-muted mt-1 text-sm">
        {info.server_version} · {info.operating_system} · {info.architecture}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="border-border bg-elevated hover:bg-hover rounded-[12px] border p-5 transition-colors"
          >
            <div className="text-muted flex items-center justify-between text-sm">
              <span>{card.label}</span>
              <card.icon className="size-4" strokeWidth={1.5} />
            </div>
            <p className="mt-3 font-sans text-[1.5rem] tracking-[-0.03em] tabular-nums">
              {card.value}
            </p>
            <p className="text-faint mt-1 text-sm">{card.meta}</p>
          </Link>
        ))}
      </div>

      <p className="text-faint mt-8 text-sm">Disk</p>
      {df.isLoading && !df.data ? (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <DiskCard label="Images" kind={df.data?.images} to="/images" icon={Box} />
          <DiskCard
            label="Containers"
            kind={df.data?.containers}
            to="/containers"
            icon={Container}
          />
          <DiskCard label="Volumes" kind={df.data?.volumes} to="/volumes" icon={HardDrive} />
        </div>
      )}
      {df.isError ? (
        <p className="text-muted mt-2 text-sm">
          {df.error instanceof Error ? df.error.message : String(df.error)}
        </p>
      ) : null}

      <div className="border-border bg-elevated mt-5 grid gap-3 rounded-[12px] border p-5 sm:grid-cols-3">
        <Meta label="CPUs" value={String(info.ncpu)} />
        <Meta label="Memory" value={formatBytes(info.mem_total)} />
        <Meta
          label="Container mix"
          value={`${info.containers_running} run · ${info.containers_paused} pause · ${info.containers_stopped} stop`}
        />
      </div>

      <div className="border-border bg-elevated mt-5 rounded-[12px] border p-5">
        <p className="text-faint text-sm">Events</p>
        {events.isError ? (
          <p className="text-muted mt-3 text-sm">
            {events.error instanceof Error ? events.error.message : String(events.error)}
          </p>
        ) : events.isLoading && !events.data ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : !recentEvents.length ? (
          <p className="text-muted mt-3 text-sm">No events in the last 5 minutes.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentEvents.map((event, index) => (
              <EventRow
                key={`${event.time}-${event.type}-${event.action}-${event.actor_id}-${index}`}
                event={event}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-faint text-sm">{label}</p>
      <p className="text-ink mt-1">{value}</p>
    </div>
  )
}

function DiskCard({
  label,
  kind,
  to,
  icon: Icon,
}: {
  label: string
  kind?: DiskUsageKind
  to: string
  icon: typeof Box
}) {
  return (
    <Link
      to={to}
      className="border-border bg-elevated hover:bg-hover rounded-[12px] border p-5 transition-colors"
    >
      <div className="text-muted flex items-center justify-between text-sm">
        <span>{label}</span>
        <Icon className="size-4" strokeWidth={1.5} />
      </div>
      <p className="mt-3 font-sans text-[1.5rem] tracking-[-0.03em] tabular-nums">
        {kind ? formatBytes(kind.size) : "—"}
      </p>
      <p className="text-faint mt-1 text-sm">
        {kind ? `${formatBytes(kind.reclaimable)} reclaimable` : "disk"}
      </p>
    </Link>
  )
}

function EventRow({ event }: { event: EngineEvent }) {
  return (
    <li className="flex min-w-0 items-baseline gap-3 text-sm">
      <span className="text-faint w-20 shrink-0">{event.type || "event"}</span>
      <span className="text-ink w-24 shrink-0 truncate">{event.action || "—"}</span>
      <span className="text-muted min-w-0 flex-1 truncate">
        {event.actor_name || (event.actor_id ? shortId(event.actor_id) : "—")}
      </span>
      <span className="text-faint shrink-0 tabular-nums">{formatAge(event.time)}</span>
    </li>
  )
}
