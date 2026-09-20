import { Copy } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Drawer } from "@/components/ui/drawer"
import { IconButton } from "@/components/ui/icon-button"
import { SearchField } from "@/components/ui/search-field"
import { Tooltip } from "@/components/ui/tooltip"
import { api, listenContainerLogs } from "@/lib/api"

export function LogsPanel({ containerId }: { containerId: string }) {
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    setLines([])
    setFilter("")
    pinned.current = true
    let disposed = false
    const start = async () => {
      const unlisten = await listenContainerLogs((chunk) => {
        if (chunk.id !== containerId) return
        setLines((current) => {
          const next = current.concat(chunk.line.replace(/\n$/, ""))
          return next.length > 2000 ? next.slice(-2000) : next
        })
      })
      if (disposed) {
        unlisten()
        return
      }
      await api.containerLogs(containerId)
      return unlisten
    }

    let unlisten: (() => void) | undefined
    void start().then((fn) => {
      unlisten = fn
    })

    return () => {
      disposed = true
      unlisten?.()
      void api.containerLogsStop(containerId)
    }
  }, [containerId])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter((line) => line.toLowerCase().includes(needle))
  }, [filter, lines])

  useEffect(() => {
    if (!pinned.current || !scroller.current) return
    scroller.current.scrollTop = scroller.current.scrollHeight
  }, [visible])

  async function copyAll() {
    const text = lines.join("\n")
    if (!text) {
      toast.error("No logs to copy")
      return
    }
    await navigator.clipboard.writeText(text)
    toast.success("Copied logs")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <SearchField
          value={filter}
          onChange={setFilter}
          placeholder="Filter logs"
          shortcut={false}
        />
        <Tooltip label="Copy logs">
          <IconButton aria-label="Copy logs" onClick={() => void copyAll()}>
            <Copy size={16} />
          </IconButton>
        </Tooltip>
      </div>
      <div
        ref={scroller}
        className="text-muted min-h-0 flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed"
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
        }}
      >
        {visible.length === 0 ? (
          <p className="text-faint">{lines.length ? "No matching lines" : "Waiting for logs…"}</p>
        ) : (
          visible.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap select-text">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function LogsDrawer({
  open,
  containerId,
  title,
  onClose,
}: {
  open: boolean
  containerId: string | null
  title: string
  onClose: () => void
}) {
  return (
    <Drawer open={open} title={title} onClose={onClose}>
      {open && containerId ? <LogsPanel containerId={containerId} /> : null}
    </Drawer>
  )
}
