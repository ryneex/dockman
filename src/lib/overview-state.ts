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

function isZeroTime(value: string) {
  return !value || value.startsWith("0001-01-01")
}

function formatInspectTime(value: string) {
  if (isZeroTime(value)) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function stateOf(inspect: Record<string, unknown>) {
  const state = pick(inspect, "State", "state")
  return isRecord(state) ? state : {}
}

export type OverviewNetwork = {
  name: string
  ip: string
}

export type OverviewState = {
  health: string
  exitCode: number | null
  startedAt: string
  finishedAt: string
  networks: OverviewNetwork[]
}

function healthFromState(state: Record<string, unknown>) {
  const health = pick(state, "Health", "health")
  if (!isRecord(health)) return ""
  const status = asString(pick(health, "Status", "status")).toLowerCase()
  if (!status || status === "none") return ""
  return status
}

function exitCodeFromState(state: Record<string, unknown>) {
  const raw = pick(state, "ExitCode", "exit_code")
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function networksFromInspect(inspect: Record<string, unknown>): OverviewNetwork[] {
  const settings = pick(inspect, "NetworkSettings", "network_settings")
  const endpoints = isRecord(settings) ? pick(settings, "Networks", "networks") : undefined
  if (!isRecord(endpoints)) return []
  return Object.entries(endpoints).map(([name, raw]) => {
    const ip = isRecord(raw)
      ? [
          asString(pick(raw, "IPAddress", "ip_address")),
          asString(pick(raw, "GlobalIPv6Address", "global_ipv6_address")),
        ]
          .filter(Boolean)
          .join(" · ")
      : ""
    return { name, ip }
  })
}

export function overviewStateFromInspect(inspect: unknown): OverviewState | null {
  if (!isRecord(inspect)) return null
  const state = stateOf(inspect)
  return {
    health: healthFromState(state),
    exitCode: exitCodeFromState(state),
    startedAt: formatInspectTime(asString(pick(state, "StartedAt", "started_at"))),
    finishedAt: formatInspectTime(asString(pick(state, "FinishedAt", "finished_at"))),
    networks: networksFromInspect(inspect),
  }
}

export function healthTone(status: string) {
  if (status === "healthy") return "running"
  if (status === "unhealthy") return "exited"
  if (status === "starting") return "restarting"
  return "unknown"
}
