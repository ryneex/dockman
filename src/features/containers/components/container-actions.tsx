import { Pause, Pencil, Play, RotateCw, Square, Trash2 } from "lucide-react"

import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import type { ContainerRow } from "@/lib/types"

import { useContainerAct } from "../lib/use-container-act"

export function ContainerActions({
  row,
  act,
  onRename,
  onRemove,
}: {
  row: ContainerRow
  act: ReturnType<typeof useContainerAct>
  onRename: () => void
  onRemove: () => void
}) {
  const running = row.state === "running"
  const paused = row.state === "paused"

  return (
    <div className="flex items-center">
      <Tooltip label={running || paused ? "Stop" : "Start"}>
        <IconButton
          onClick={(event) => {
            event.stopPropagation()
            act.mutate({ id: row.id, op: running || paused ? "stop" : "start" })
          }}
        >
          {running || paused ? <Square size={16} /> : <Play size={16} />}
        </IconButton>
      </Tooltip>
      {paused ? (
        <Tooltip label="Unpause">
          <IconButton
            onClick={(event) => {
              event.stopPropagation()
              act.mutate({ id: row.id, op: "unpause" })
            }}
          >
            <Play size={16} />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip label="Pause">
          <IconButton
            disabled={!running}
            onClick={(event) => {
              event.stopPropagation()
              act.mutate({ id: row.id, op: "pause" })
            }}
          >
            <Pause size={16} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip label="Restart">
        <IconButton
          onClick={(event) => {
            event.stopPropagation()
            act.mutate({ id: row.id, op: "restart" })
          }}
        >
          <RotateCw size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip label="Rename">
        <IconButton
          onClick={(event) => {
            event.stopPropagation()
            onRename()
          }}
        >
          <Pencil size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip label="Remove">
        <IconButton
          danger
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Trash2 size={16} />
        </IconButton>
      </Tooltip>
    </div>
  )
}
