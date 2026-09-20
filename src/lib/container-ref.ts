import type { ContainerRow } from "@/lib/types"

export function findContainer(rows: ContainerRow[] | undefined, raw: string) {
  const needle = raw.trim()
  if (!needle || !rows?.length) return null
  const exact = rows.find((row) => row.id === needle)
  if (exact) return exact
  const matches = rows.filter((row) => row.id.startsWith(needle) || row.id.endsWith(needle))
  return matches.length === 1 ? matches[0] : null
}
