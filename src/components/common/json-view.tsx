function tokenize(json: string) {
  const tokens: Array<{ text: string; kind: string }> = []
  const pattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(json))) {
    if (match.index > last) {
      tokens.push({ text: json.slice(last, match.index), kind: "plain" })
    }
    const value = match[0]
    let kind = "number"
    if (value[0] === '"') kind = match[2] ? "key" : "string"
    else if (value === "true" || value === "false") kind = "bool"
    else if (value === "null") kind = "null"
    tokens.push({ text: value, kind })
    last = pattern.lastIndex
  }
  if (last < json.length) tokens.push({ text: json.slice(last), kind: "plain" })
  return tokens
}

const colors: Record<string, string> = {
  key: "text-accent",
  string: "text-running",
  number: "text-paused",
  bool: "text-exited",
  null: "text-faint",
  plain: "text-muted",
}

export function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "null"
  return (
    <pre className="p-4 font-mono text-sm leading-relaxed select-text">
      {tokenize(text).map((token, index) => (
        <span key={index} className={colors[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  )
}
