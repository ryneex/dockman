import { Pause, Pencil, Play, RotateCw, Square, SquareTerminal, Trash2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useSettings } from "@/components/providers"
import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
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
  const navigate = useNavigate()
  const { settings } = useSettings()
  const running = row.state === "running"
  const paused = row.state === "paused"

  const canExec = running && !paused
  const openInDockman = settings.terminalTarget === "embedded"

  return (
    <div className="flex items-center">
      <Tooltip
        label={
          canExec
            ? openInDockman
              ? "Open terminal in Dockman"
              : "Open terminal"
            : paused
              ? "Unpause the container to open a terminal"
              : "Start the container to open a terminal"
        }
      >
        <IconButton
          disabled={!canExec}
          aria-label="Open terminal"
          onClick={(event) => {
            event.stopPropagation()
            if (openInDockman) {
              void navigate(`/containers/${row.id}/terminal`)
              return
            }
            void api
              .containerOpenTerminal(
                row.id,
                settings.terminalApp === "auto" ? null : settings.terminalApp,
              )
              .catch((error) => toast.error(String(error)))
          }}
        >
          <SquareTerminal size={16} />
        </IconButton>
      </Tooltip>
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
