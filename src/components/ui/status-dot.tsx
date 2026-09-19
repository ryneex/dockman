import { motion } from "framer-motion"

import { cn } from "@/lib/utils"

const colors: Record<string, string> = {
  running: "bg-running",
  restarting: "bg-accent",
  paused: "bg-paused",
  exited: "bg-exited",
  dead: "bg-exited",
  created: "bg-created",
  removing: "bg-faint",
  unknown: "bg-faint",
}

export function StatusDot({ state, layoutId }: { state: string; layoutId?: string }) {
  const tone = colors[state] ?? "bg-faint"
  return (
    <motion.span
      layoutId={layoutId}
      className={cn("inline-block size-2 shrink-0 rounded-full", tone)}
    />
  )
}

export function StatusChip({ state, label }: { state: string; label?: string }) {
  return (
    <span className="bg-hover text-muted inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-sm">
      <StatusDot state={state} layoutId={`status-${label ?? state}`} />
      <span className="capitalize">{label ?? state}</span>
    </span>
  )
}
