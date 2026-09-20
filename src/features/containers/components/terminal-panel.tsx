import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { api, listenContainerTerm } from "@/lib/api"
import type { ContainerRow } from "@/lib/types"

import "@xterm/xterm/css/xterm.css"

export function TerminalPanel({ row }: { row: ContainerRow }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [ended, setEnded] = useState(false)
  const running = row.state === "running"

  useEffect(() => {
    return () => {
      void api.containerTermStop(row.id)
    }
  }, [row.id, running])

  useEffect(() => {
    const el = host.current
    if (!el || !running) return

    let disposed = false
    let term: Terminal | undefined
    let unlisten: (() => void) | undefined
    const fit = new FitAddon()
    setError(null)
    setEnded(false)

    const start = async () => {
      term = new Terminal({
        cursorBlink: true,
        fontFamily: "Geist Mono Variable, ui-monospace, monospace",
        fontSize: 13,
        theme: {
          background: "#0b0d12",
          foreground: "#e8ecf4",
          cursor: "#5b8cff",
          selectionBackground: "rgba(91, 140, 255, 0.28)",
        },
      })
      term.loadAddon(fit)
      term.open(el)
      fit.fit()

      unlisten = await listenContainerTerm(
        (chunk) => {
          if (chunk.id !== row.id) return
          term?.write(chunk.data)
        },
        (id) => {
          if (id === row.id) {
            term?.write("\r\n[session ended]\r\n")
            if (!disposed) setEnded(true)
          }
        },
      )
      if (disposed) {
        unlisten()
        return
      }
      await api.containerTermStart(row.id)
      if (disposed) return
      await api.containerTermResize(row.id, term.cols, term.rows)
      term.onData((data) => {
        void api.containerTermWrite(row.id, data)
      })
      term.onResize(({ cols, rows }) => {
        void api.containerTermResize(row.id, cols, rows)
      })
      term.focus()
    }

    void start().catch((err) => {
      if (!disposed) setError(String(err))
    })

    const observer = new ResizeObserver(() => {
      if (!disposed) fit.fit()
    })
    observer.observe(el)

    return () => {
      disposed = true
      observer.disconnect()
      unlisten?.()
      term?.dispose()
    }
  }, [row.id, running, session])

  if (!running) {
    return (
      <EmptyState title="Container is not running" body="Start it to open a shell in Dockman." />
    )
  }

  return (
    <div className="bg-canvas flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-muted text-sm">{ended ? "Session ended" : "Shell"}</p>
        <Button
          icon={<RotateCw />}
          onClick={() => {
            setError(null)
            setEnded(false)
            setSession((current) => current + 1)
          }}
        >
          Restart
        </Button>
      </div>
      {error ? <p className="text-muted px-4 py-3 text-sm">{error}</p> : null}
      <div ref={host} data-terminal className="min-h-0 flex-1 px-3 py-2" />
    </div>
  )
}
