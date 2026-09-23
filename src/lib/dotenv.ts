export type DotenvEntry = {
  key: string
  value: string
}

function needsQuotes(value: string) {
  return value === "" || /[\s#"']/.test(value) || value.includes("\\")
}

function quotedValue(value: string) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\n|\r/g, "\\n")}"`
}

export function formatDotenv(entries: readonly DotenvEntry[]) {
  const lines = entries.map((entry) =>
    needsQuotes(entry.value)
      ? `${entry.key}=${quotedValue(entry.value)}`
      : `${entry.key}=${entry.value}`,
  )
  return `${lines.join("\n")}\n`
}
