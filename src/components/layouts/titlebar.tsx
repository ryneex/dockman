import { getCurrentWindow } from "@tauri-apps/api/window"
import { Minus, Square, X } from "lucide-react"

import { Wordmark } from "@/components/common"
import { IconButton } from "@/components/ui/icon-button"
import { useEngine } from "@/lib/queries"
import { cn } from "@/lib/utils"

export function Titlebar() {
  const engine = useEngine()
  const connected = engine.isSuccess

  return (
    <div
      data-tauri-drag-region
      className="border-border flex h-12 shrink-0 items-center justify-between border-b px-4"
    >
      <div data-tauri-drag-region>
        <Wordmark />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-sm",
            connected
              ? "border-running/20 bg-running/10 text-running"
              : "border-exited/20 bg-exited/10 text-exited",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              connected ? "bg-running animate-[pulse_1.4s_ease-out_1]" : "bg-exited",
            )}
          />
          {connected ? "Connected" : "Disconnected"}
        </span>
        <div className="flex items-center">
          <IconButton aria-label="Minimize" onClick={() => getCurrentWindow().minimize()}>
            <Minus size={16} />
          </IconButton>
          <IconButton aria-label="Maximize" onClick={() => getCurrentWindow().toggleMaximize()}>
            <Square size={14} />
          </IconButton>
          <IconButton aria-label="Close" danger onClick={() => getCurrentWindow().close()}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
