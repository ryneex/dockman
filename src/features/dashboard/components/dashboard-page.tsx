import { Box, Container, HardDrive, Network, RefreshCw } from "lucide-react"
import { Link } from "react-router-dom"

import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { formatBytes } from "@/lib/format"
import { useEngine, useImages, useNetworks, useVolumes } from "@/lib/queries"

export function DashboardPage() {
  const engine = useEngine()
  const images = useImages()
  const volumes = useVolumes()
  const networks = useNetworks()

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

      <div className="border-border bg-elevated mt-5 grid gap-3 rounded-[12px] border p-5 sm:grid-cols-3">
        <Meta label="CPUs" value={String(info.ncpu)} />
        <Meta label="Memory" value={formatBytes(info.mem_total)} />
        <Meta
          label="Container mix"
          value={`${info.containers_running} run · ${info.containers_paused} pause · ${info.containers_stopped} stop`}
        />
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
