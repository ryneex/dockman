import { useEffect, useRef, useState } from "react"

import { Drawer } from "@/components/ui/drawer"
import { listenContainerLogs, api } from "@/lib/api"

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
  const [lines, setLines] = useState<string[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    if (!open || !containerId) return
    setLines([])
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
  }, [open, containerId])

  useEffect(() => {
    if (!pinned.current || !scroller.current) return
    scroller.current.scrollTop = scroller.current.scrollHeight
  }, [lines])

  return (
    <Drawer open={open} title={title} onClose={onClose}>
      <div
        ref={scroller}
        className="text-muted h-full overflow-auto p-4 font-mono text-sm leading-relaxed"
        onScroll={(event) => {
          const el = event.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
        }}
      >
        {lines.length === 0 ? (
          <p className="text-faint">Waiting for logs…</p>
        ) : (
          lines.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap select-text">
              {line}
            </div>
          ))
        )}
      </div>
    </Drawer>
  )
}
