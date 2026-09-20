import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom"
import { toast } from "sonner"

import { CopyId, JsonView, LogsPanel } from "@/components/common"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusChip } from "@/components/ui/status-dot"
import { api } from "@/lib/api"
import { findContainer } from "@/lib/container-ref"
import { useContainers } from "@/lib/queries"
import type { ContainerRow } from "@/lib/types"
import { cn } from "@/lib/utils"

import { useContainerAct } from "../lib/use-container-act"
import { ContainerActions } from "./container-actions"
import { FilesPanel } from "./files-drawer"
import { PortList } from "./port-list"
import { RenameContainerDialog } from "./rename-container-dialog"
import { TerminalPanel } from "./terminal-panel"

const tabs = [
  { to: ".", label: "Logs", end: true },
  { to: "files", label: "Files" },
  { to: "terminal", label: "Terminal" },
  { to: "inspect", label: "Inspect" },
]

export function ContainerPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const query = useContainers()
  const client = useQueryClient()
  const row = findContainer(query.data, id)
  const act = useContainerAct()
  const [renameOpen, setRenameOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  const remove = useMutation({
    mutationFn: async (target: string) => {
      await api.containerRemove(target)
    },
    onSuccess: () => {
      setRemoveOpen(false)
      toast.success("Removed container")
      void navigate("/containers")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["containers"] })
      void client.invalidateQueries({ queryKey: ["engine"] })
    },
  })

  if (query.isError) {
    return (
      <EmptyState
        title="Could not load container"
        body={String(query.error)}
        action={{ label: "Back to containers", onClick: () => void navigate("/containers") }}
      />
    )
  }

  if (query.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <TableSkeleton />
      </div>
    )
  }

  if (!row) {
    return (
      <EmptyState
        title="Container not found"
        body="It may have been removed, or this ID does not match a local container."
        action={{ label: "Back to containers", onClick: () => void navigate("/containers") }}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <IconButton aria-label="Back to containers" onClick={() => void navigate("/containers")}>
            <ArrowLeft size={16} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate tracking-[-0.03em]">{row.name || "—"}</h1>
              <StatusChip state={row.state} label={row.status} />
            </div>
            <div className="text-muted mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="truncate">{row.image}</span>
              <PortList ports={row.ports} />
              <CopyId id={row.id} />
            </div>
          </div>
          <ContainerActions
            row={row}
            act={act}
            onRename={() => setRenameOpen(true)}
            onRemove={() => setRemoveOpen(true)}
          />
        </div>
        <nav className="flex gap-1 px-4">
          {tabs.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-accent text-ink"
                    : "text-muted hover:text-ink border-transparent",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet context={row} />
      </div>
      <RenameContainerDialog
        open={renameOpen}
        id={row.id}
        name={row.name}
        onOpenChange={setRenameOpen}
      />
      <ConfirmDialog
        open={removeOpen}
        title="Remove container"
        description={`This will permanently remove ${row.name || "this container"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate(row.id)}
        onClose={() => setRemoveOpen(false)}
      />
    </div>
  )
}

export function ContainerLogsTab() {
  const row = useOutletContext<ContainerRow>()
  return <LogsPanel containerId={row.id} />
}

export function ContainerFilesTab() {
  const row = useOutletContext<ContainerRow>()
  return <FilesPanel containerId={row.id} />
}

export function ContainerTerminalTab() {
  const row = useOutletContext<ContainerRow>()
  return <TerminalPanel row={row} />
}

export function ContainerInspectTab() {
  const row = useOutletContext<ContainerRow>()
  const inspect = useQuery({
    queryKey: ["container-inspect", row.id],
    queryFn: () => api.containerInspect(row.id),
  })
  if (inspect.isLoading) {
    return (
      <div className="p-4">
        <TableSkeleton />
      </div>
    )
  }
  if (inspect.isError) {
    return <p className="text-muted p-5">{String(inspect.error)}</p>
  }
  return (
    <div className="h-full min-h-0 overflow-auto">
      <JsonView value={inspect.data} />
    </div>
  )
}
