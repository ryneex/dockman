export function parseLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parsePorts(text: string) {
  const ports = parseLines(text)
  for (const port of ports) {
    if (!/^\d{1,5}(?::\d{1,5})?$/.test(port)) {
      return { ok: false as const, error: `Invalid port mapping: ${port}` }
    }
  }
  return { ok: true as const, ports }
}

export function parseEnv(text: string) {
  const env = parseLines(text)
  for (const line of env) {
    if (!line.includes("=")) {
      return { ok: false as const, error: `Env vars must be KEY=value (${line})` }
    }
  }
  return { ok: true as const, env }
}
