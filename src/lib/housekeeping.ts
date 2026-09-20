import { formatBytes } from "@/lib/format"
import type { PruneResult, UsageRef } from "@/lib/types"

export function isActiveContainer(state: string) {
  return state === "running" || state === "paused" || state === "restarting"
}

export function isUnused(row: { used_by?: UsageRef[] }) {
  return !row.used_by?.length
}

export function pruneMessage(kind: string, result: PruneResult) {
  if (!result.deleted) return `No unused ${kind} to remove`
  const space = result.space_reclaimed > 0 ? ` · ${formatBytes(result.space_reclaimed)}` : ""
  return `Removed ${result.deleted} ${kind}${space}`
}
