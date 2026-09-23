import type { RunContainerValues } from "@/lib/create-form"
import type { RestartPolicy } from "@/lib/types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function pick(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key]
    }
  }
  return undefined
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  }
  if (typeof value === "string" && value) return [value]
  return []
}

function configOf(inspect: Record<string, unknown>) {
  const config = pick(inspect, "Config", "config")
  return isRecord(config) ? config : {}
}

function hostConfigOf(inspect: Record<string, unknown>) {
  const host = pick(inspect, "HostConfig", "host_config")
  return isRecord(host) ? host : {}
}

function joinLines(values: string[]) {
  return values.join("\n")
}

function portsFromBindings(raw: unknown) {
  if (!isRecord(raw)) return []
  const lines: string[] = []
  for (const [key, bindings] of Object.entries(raw)) {
    const [container, rawProto] = key.split("/")
    const proto = (rawProto ?? "tcp").toLowerCase()
    if ((proto !== "tcp" && proto !== "udp") || !container || !/^\d{1,5}$/.test(container)) continue
    const rows = Array.isArray(bindings) ? bindings : []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const host = asString(pick(row, "HostPort", "host_port")).trim()
      if (!host || !/^\d{1,5}$/.test(host)) continue
      const mapping = host === container ? host : `${host}:${container}`
      lines.push(proto === "tcp" ? mapping : `${mapping}/${proto}`)
    }
  }
  return [...new Set(lines)]
}

function memoryFromHost(raw: unknown) {
  const bytes = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return ""
  const gib = 1024 * 1024 * 1024
  const mib = 1024 * 1024
  const kib = 1024
  if (bytes % gib === 0) return `${bytes / gib}g`
  if (bytes % mib === 0) return `${bytes / mib}m`
  if (bytes % kib === 0) return `${bytes / kib}k`
  return String(bytes)
}

function mountsFromBinds(raw: unknown) {
  return asStringList(raw)
}

function mountsFromMounts(raw: unknown) {
  if (!Array.isArray(raw)) return []
  const lines: string[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const type = asString(pick(item, "Type", "type")).toLowerCase()
    const target = asString(pick(item, "Destination", "destination", "Target", "target"))
    if (!target.startsWith("/")) continue
    const rw = pick(item, "RW", "rw")
    const suffix = rw === false ? ":ro" : ""
    if (type === "volume") {
      const name = asString(pick(item, "Name", "name", "Source", "source"))
      if (name) lines.push(`${name}:${target}${suffix}`)
      continue
    }
    if (type === "bind" || type === "") {
      const source = asString(pick(item, "Source", "source"))
      if (source.startsWith("/")) lines.push(`${source}:${target}${suffix}`)
    }
  }
  return lines
}

function networkFromMode(mode: string) {
  const value = mode.trim()
  if (!value || value === "default" || value === "bridge") return ""
  if (value.startsWith("container:")) return ""
  return value
}

function restartFromPolicy(raw: unknown): RestartPolicy {
  const name = isRecord(raw)
    ? asString(pick(raw, "Name", "name"))
        .toLowerCase()
        .replace(/_/g, "-")
    : ""
  if (name === "on-failure" || name === "always" || name === "unless-stopped") return name
  return "no"
}

export function runValuesFromInspect(inspect: unknown): RunContainerValues | null {
  if (!isRecord(inspect)) return null
  const config = configOf(inspect)
  const host = hostConfigOf(inspect)
  const image = asString(pick(config, "Image", "image")).trim()
  if (!image) return null
  const binds = mountsFromBinds(pick(host, "Binds", "binds"))
  return {
    image,
    name: asString(pick(inspect, "Name", "name")).replace(/^\//, ""),
    cmd: joinLines(asStringList(pick(config, "Cmd", "cmd"))),
    entrypoint: joinLines(asStringList(pick(config, "Entrypoint", "entrypoint"))),
    user: asString(pick(config, "User", "user")),
    workdir: asString(pick(config, "WorkingDir", "working_dir")),
    memory: memoryFromHost(pick(host, "Memory", "memory")),
    ports: joinLines(portsFromBindings(pick(host, "PortBindings", "port_bindings"))),
    mounts: joinLines(binds.length ? binds : mountsFromMounts(pick(inspect, "Mounts", "mounts"))),
    env: joinLines(asStringList(pick(config, "Env", "env"))),
    network: networkFromMode(asString(pick(host, "NetworkMode", "network_mode"))),
    restart: restartFromPolicy(pick(host, "RestartPolicy", "restart_policy")),
    start: true,
  }
}

export function overviewFromInspect(inspect: unknown) {
  const values = runValuesFromInspect(inspect)
  if (!values || !isRecord(inspect)) return null
  const networks = pick(inspect, "NetworkSettings", "network_settings")
  const endpoints = isRecord(networks) ? pick(networks, "Networks", "networks") : undefined
  const names = isRecord(endpoints)
    ? Object.keys(endpoints)
    : values.network
      ? [values.network]
      : []
  return {
    image: values.image,
    name: values.name,
    cmd: values.cmd,
    entrypoint: joinLines(asStringList(pick(configOf(inspect), "Entrypoint", "entrypoint"))),
    env: values.env
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const sep = line.indexOf("=")
        return sep === -1
          ? { key: line, value: "" }
          : { key: line.slice(0, sep), value: line.slice(sep + 1) }
      }),
    ports: values.ports.split("\n").filter(Boolean),
    mounts: values.mounts.split("\n").filter(Boolean),
    networks: names,
    restart: values.restart,
  }
}
