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

function configOf(inspect: unknown) {
  if (!isRecord(inspect)) return null
  const config = inspect.Config ?? inspect.config
  return isRecord(config) ? config : null
}

function configPorts(inspect: unknown) {
  const config = configOf(inspect)
  if (!config) return []
  return portKeys(config.ExposedPorts ?? config.exposed_ports)
}

export function cmdFromInspect(inspect: unknown) {
  const config = configOf(inspect)
  if (!config) return []
  const raw = config.Cmd ?? config.cmd
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.length > 0)
  }
  if (typeof raw === "string" && raw) return [raw]
  return []
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

export function exposedPortSpecsFromInspect(inspect: unknown) {
  const specs = new Set<string>()
  for (const key of configPorts(inspect)) {
    const [port, rawProto = "tcp"] = key.split("/")
    if (!port || !/^\d{1,5}$/.test(port)) continue
    const value = Number(port)
    if (value < 1 || value > 65535) continue
    const proto = rawProto.toLowerCase() || "tcp"
    if (proto !== "tcp" && proto !== "udp") continue
    specs.add(`${port}/${proto}`)
  }
  return [...specs].sort((a, b) => {
    const [aPort = "0", aProto = "tcp"] = a.split("/")
    const [bPort = "0", bProto = "tcp"] = b.split("/")
    return Number(aPort) - Number(bPort) || aProto.localeCompare(bProto)
  })
}

export function envFromInspect(inspect: unknown) {
  const config = configOf(inspect)
  if (!config) return []
  const raw = config.Env ?? config.env
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((line) => {
      const sep = line.indexOf("=")
      return sep === -1
        ? { key: line, value: "" }
        : { key: line.slice(0, sep), value: line.slice(sep + 1) }
    })
}

export function workingDirFromInspect(inspect: unknown) {
  const config = configOf(inspect)
  if (!config) return "/"
  const raw = config.WorkingDir ?? config.working_dir
  if (typeof raw !== "string") return "/"
  const trimmed = raw.trim()
  if (!trimmed || trimmed === ".") return "/"
  const withoutDot = trimmed.replace(/^\.\//, "")
  const absolute = withoutDot.startsWith("/") ? withoutDot : `/${withoutDot}`
  const collapsed = absolute.replace(/\/+/g, "/")
  return collapsed === "/" ? "/" : collapsed.replace(/\/+$/, "")
}

export function splitImageRef(ref: string) {
  const trimmed = ref.trim()
  if (!trimmed) return { repo: "", tag: "" }
  const colon = trimmed.lastIndexOf(":")
  if (colon > 0 && !trimmed.slice(colon + 1).includes("/")) {
    return { repo: trimmed.slice(0, colon), tag: trimmed.slice(colon + 1) }
  }
  return { repo: trimmed, tag: "" }
}
