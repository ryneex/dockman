import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"

/** Host TCP port from a published mapping, or null for UDP / unpublished list ports. */
export function hostTcpPort(mapping: string, allowBare = false) {
  const value = mapping.trim()
  if (!value || /\/(udp|sctp)$/i.test(value)) return null

  const arrow = value.match(/(\d{1,5})\s*->/)
  if (arrow?.[1]) return arrow[1]

  const withoutProto = value.replace(/\/tcp$/i, "")
  if (/^\d{1,5}:\d{1,5}$/.test(withoutProto)) {
    return withoutProto.split(":")[0] ?? null
  }
  if (allowBare && /^\d{1,5}$/.test(withoutProto)) return withoutProto
  return null
}

export function publishedUrl(hostPort: string) {
  return `http://127.0.0.1:${hostPort}`
}

export async function openPublishedPort(hostPort: string) {
  const url = publishedUrl(hostPort)
  try {
    await openUrl(url)
  } catch (error) {
    toast.error(String(error))
  }
}
