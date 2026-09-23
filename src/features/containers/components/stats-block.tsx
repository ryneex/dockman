import { formatBytes } from "@/lib/format"
import type { ContainerStats } from "@/lib/types"
import { cn } from "@/lib/utils"

export function formatCpuPercent(percent: number) {
  if (!Number.isFinite(percent) || percent <= 0) return "0%"
  return `${percent < 10 ? percent.toFixed(1) : percent.toFixed(0)}%`
}

export function formatMemUsage(used: number, limit: number) {
  const usedLabel = formatBytes(used)
  if (!limit) return usedLabel
  return `${usedLabel} / ${formatBytes(limit)}`
}

export function formatNetIo(rx: number, tx: number) {
  return `${formatBytes(rx)} ↓  ${formatBytes(tx)} ↑`
}

export function StatsBlock({
  stats,
  className,
}: {
  stats?: ContainerStats | null
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums", className)}>
      <Stat label="CPU" value={stats ? formatCpuPercent(stats.cpu_percent) : "—"} />
      <Stat
        label="Memory"
        value={stats ? formatMemUsage(stats.memory_used, stats.memory_limit) : "—"}
      />
      <Stat label="Net I/O" value={stats ? formatNetIo(stats.net_rx, stats.net_tx) : "—"} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-faint">{label} </span>
      <span className="text-muted">{value}</span>
    </p>
  )
}
