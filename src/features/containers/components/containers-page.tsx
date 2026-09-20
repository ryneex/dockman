import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FileText,
  Folder,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ScanSearch,
  Square,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CopyId, InspectDrawer, LogsDrawer, RowActions } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusChip } from "@/components/ui/status-dot"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { formatAge, matchesQuery } from "@/lib/format"
import { useContainers } from "@/lib/queries"
import type { ContainerRow } from "@/lib/types"
import { useTableNav } from "@/lib/use-table-nav"

import { FilesDrawer } from "./files-drawer"
import { PortList } from "./port-list"
import { RunContainerDialog } from "./run-container-dialog"

export function ContainersPage() {
  const query = useContainers()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [logsId, setLogsId] = useState<string | null>(null)
  const [filesId, setFilesId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ContainerRow | null>(null)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(
          filter,
          row.name,
          row.image,
          row.id,
          row.state,
          row.status,
          row.ports.join(" "),
        ),
      ),
    [filter, query.data],
  )

  const inspect = useQuery({
    queryKey: ["container-inspect", inspectId],
    queryFn: () => api.containerInspect(inspectId!),
    enabled: Boolean(inspectId),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectId(row.id))
  const selected = inspectId ? rows.find((row) => row.id === inspectId) : undefined
  const logsRow = logsId ? rows.find((row) => row.id === logsId) : undefined
  const filesRow = filesId ? rows.find((row) => row.id === filesId) : undefined

  const act = useMutation({
    mutationFn: async ({ id, op }: { id: string; op: "start" | "stop" | "restart" }) => {
      if (op === "start") return api.containerStart(id)
      if (op === "stop") return api.containerStop(id)
      return api.containerRestart(id)
    },
    onMutate: async ({ id, op }) => {
      await client.cancelQueries({ queryKey: ["containers"] })
      const previous = client.getQueryData<ContainerRow[]>(["containers"])
      client.setQueryData<ContainerRow[]>(["containers"], (current = []) =>
        current.map((row) =>
          row.id === id
            ? {
                ...row,
                state: op === "stop" ? "exited" : "running",
                status:
                  op === "restart"
                    ? "restarting..."
                    : op === "stop"
                      ? "stopping..."
                      : "starting...",
              }
            : row,
        ),
      )
      return { previous }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) client.setQueryData(["containers"], ctx.previous)
      toast.error(String(error))
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["containers"] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.containerRemove(id),
    onSuccess: () => {
      setRemoveTarget(null)
      void client.invalidateQueries({ queryKey: ["containers"] })
    },
    onError: (error) => toast.error(String(error)),
  })

  const body = query.isError ? (
    <EmptyState
      title="Could not list containers"
      body={String(query.error)}
      action={{ label: "Retry", onClick: () => void query.refetch(), icon: RefreshCw }}
    />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No containers"
      body="Nothing is created on this engine yet."
      action={{ label: "New", onClick: () => setCreateOpen(true), icon: Plus }}
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-[16%]", "w-[22%]", "w-[20%]", "w-[22%]", "w-[8%]", "w-[12%]", "w-0"]}>
      <THead columns={["Name", "Image", "Status", "Ports", "Age", "ID", ""]} />
      <tbody>
        {rows.map((row, rowIndex) => {
          const running = row.state === "running"
          return (
            <TRow key={row.id} active={rowIndex === index} onClick={() => setIndex(rowIndex)}>
              <TCell>{row.name || "—"}</TCell>
              <TCell className="text-muted">{row.image}</TCell>
              <TCell>
                <StatusChip state={row.state} label={row.status} />
              </TCell>
              <TCell>
                <PortList ports={row.ports} />
              </TCell>
              <TCell className="text-muted">{formatAge(row.created)}</TCell>
              <TCell>
                <CopyId id={row.id} />
              </TCell>
              <RowActions>
                <Tooltip label={running ? "Stop" : "Start"}>
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation()
                      act.mutate({ id: row.id, op: running ? "stop" : "start" })
                    }}
                  >
                    {running ? <Square size={16} /> : <Play size={16} />}
                  </IconButton>
                </Tooltip>
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
                <Tooltip label="Logs">
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation()
                      setLogsId(row.id)
                    }}
                  >
                    <FileText size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Files">
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation()
                      setFilesId(row.id)
                    }}
                  >
                    <Folder size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Inspect">
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation()
                      setInspectId(row.id)
                    }}
                  >
                    <ScanSearch size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Remove">
                  <IconButton
                    danger
                    onClick={(event) => {
                      event.stopPropagation()
                      setRemoveTarget(row)
                    }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Tooltip>
              </RowActions>
            </TRow>
          )
        })}
      </tbody>
    </Table>
  )

  return (
    <ListPage
      action={<RunContainerDialog open={createOpen} trigger onOpenChange={setCreateOpen} />}
    >
      {body}
      <InspectDrawer
        open={Boolean(inspectId)}
        title={selected?.name ?? "Inspect"}
        data={inspect.data}
        loading={inspect.isLoading}
        onClose={() => setInspectId(null)}
      />
      <LogsDrawer
        open={Boolean(logsId)}
        containerId={logsId}
        title={logsRow ? `Logs · ${logsRow.name}` : "Logs"}
        onClose={() => setLogsId(null)}
      />
      <FilesDrawer
        open={Boolean(filesId)}
        containerId={filesId}
        title={filesRow ? `Files · ${filesRow.name}` : "Files"}
        onClose={() => setFilesId(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove container"
        description={`This will permanently remove ${removeTarget?.name ?? "this container"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate(removeTarget.id)}
        onClose={() => setRemoveTarget(null)}
      />
    </ListPage>
  )
}
