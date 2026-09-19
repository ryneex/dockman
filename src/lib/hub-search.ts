export function hubSearchTerm(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  const withoutDigest = trimmed.split("@")[0] ?? trimmed
  const colon = withoutDigest.lastIndexOf(":")
  if (colon > 0 && !withoutDigest.slice(colon + 1).includes("/")) {
    return withoutDigest.slice(0, colon)
  }
  return withoutDigest
}

export function filterLocalImageTags(tags: string[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const seen = new Set<string>()
  const matches: string[] = []
  for (const tag of tags) {
    if (!tag || tag.includes("<none>") || seen.has(tag)) continue
    if (!tag.toLowerCase().includes(needle)) continue
    seen.add(tag)
    matches.push(tag)
  }
  return matches
}
