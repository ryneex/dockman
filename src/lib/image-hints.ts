import type { ImageRow } from "@/lib/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function withLatest(ref: string) {
  const colon = ref.lastIndexOf(":")
  if (colon > 0 && !ref.slice(colon + 1).includes("/")) return ref
  return `${ref}:latest`
}

export function resolveLocalImage(images: ImageRow[] | undefined, ref: string) {
  const trimmed = ref.trim()
  if (!trimmed || !images?.length) return null
  const digestLess = trimmed.split("@")[0] ?? trimmed
  const tagged = withLatest(digestLess)
  const short = trimmed.replace(/^sha256:/, "")
  return (
    images.find((row) => {
      if (
        row.tags.includes(trimmed) ||
        row.tags.includes(digestLess) ||
        row.tags.includes(tagged)
      ) {
        return true
      }
      if (row.id === trimmed || row.id === digestLess) return true
      return short.length >= 12 && (row.id.endsWith(short) || row.id.endsWith(`sha256:${short}`))
    }) ?? null
  )
}

function portKeys(raw: unknown) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string")
  if (isRecord(raw)) return Object.keys(raw)
  return []
}

function configPorts(inspect: unknown) {
  if (!isRecord(inspect)) return []
  const config = inspect.Config ?? inspect.config
  if (!isRecord(config)) return []
  return portKeys(config.ExposedPorts ?? config.exposed_ports)
}

export function exposedPortsFromInspect(inspect: unknown) {
  const ports = new Set<string>()
  for (const key of configPorts(inspect)) {
    const [port, proto = "tcp"] = key.split("/")
    if (!port || !/^\d{1,5}$/.test(port)) continue
    const value = Number(port)
    if (value < 1 || value > 65535) continue
    if (proto.toLowerCase() !== "tcp") continue
    ports.add(port)
  }
  return [...ports].sort((a, b) => Number(a) - Number(b))
}
