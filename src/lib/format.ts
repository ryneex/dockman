export function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value < 1000) return String(Math.floor(value))
  if (value < 1_000_000) {
    const scaled = value / 1000
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}k`
  }
  const scaled = value / 1_000_000
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "")}m`
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatAge(unixSeconds: number) {
  if (!unixSeconds) return "—"
  const seconds = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function shortId(id: string) {
  return id.replace(/^sha256:/, "").slice(0, 12)
}

export function matchesQuery(query: string, ...fields: Array<string | number | undefined>) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) =>
    String(field ?? "")
      .toLowerCase()
      .includes(needle),
  )
}
