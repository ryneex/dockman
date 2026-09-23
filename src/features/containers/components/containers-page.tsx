import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Eraser, Plus, RefreshCw, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { CopyId, RowActions, RowName } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { TableSkeleton } from "@/components/ui/skeleton"
import { StatusChip } from "@/components/ui/status-dot"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { containerMatchesQuery } from "@/lib/compose-groups"
import { formatAge } from "@/lib/format"
import { isActiveContainer, pruneMessage } from "@/lib/housekeeping"
import { useContainerStatsMap, useContainers } from "@/lib/queries"
import type { ContainerRow } from "@/lib/types"
import { useSelection } from "@/lib/use-selection"
import { useTableNav } from "@/lib/use-table-nav"

import { useContainerAct } from "../lib/use-container-act"
import { ComposeChip } from "./compose-chip"
import { ContainerActions } from "./container-actions"
import { PortList } from "./port-list"
import { RenameContainerDialog } from "./rename-container-dialog"
import { RunContainerDialog } from "./run-container-dialog"
import { formatCpuPercent, formatMemUsage, formatNetIo } from "./stats-block"

export function ContainersPage() {
  const query = useContainers()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ContainerRow | null>(null)
  const [renameTarget, setRenameTarget] = useState<ContainerRow | null>(null)
  const [pruneOpen, setPruneOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const rows = useMemo(
    () => (query.data ?? []).filter((row) => containerMatchesQuery(filter, row)),
    [filter, query.data],
  )
  const stopped = useMemo(
    () => (query.data ?? []).filter((row) => !isActiveContainer(row.state)),
    [query.data],
  )
  const runningIds = useMemo(
    () => (query.data ?? []).filter((row) => row.state === "running").map((row) => row.id),
    [query.data],
  )
  const statsMap = useContainerStatsMap(runningIds)
  const selection = useSelection(rows, (row) => row.id)
  const { index, setIndex } = useTableNav(rows, (row) => void navigate(`/containers/${row.id}`))
  const act = useContainerAct()

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const errors: string[] = []
      for (const id of ids) {
        try {
          await api.containerRemove(id)
        } catch (error) {
          errors.push(String(error))
        }
      }
      if (errors.length) throw new Error(errors[0])
    },
    onSuccess: (_data, ids) => {
      setRemoveTarget(null)
      setBulkOpen(false)
      selection.clear()
      toast.success(ids.length > 1 ? `Removed ${ids.length} containers` : "Removed container")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["containers"] })
      void client.invalidateQueries({ queryKey: ["engine"] })
    },
  })

  const prune = useMutation({
    mutationFn: api.containersPrune,
    onSuccess: (result) => {
      setPruneOpen(false)
      toast.success(pruneMessage("containers", result))
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["containers"] })
      void client.invalidateQueries({ queryKey: ["engine"] })
    },
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
    <Table
      cols={[
        "w-12",
        "w-[13%]",
        "w-[14%]",
        "w-[13%]",
        "w-[7%]",
        "w-[12%]",
        "w-[12%]",
        "w-[13%]",
        "w-[6%]",
        "w-[8%]",
        "w-0",
      ]}
    >
      <THead
        columns={[
          <Checkbox
            key="all"
            checked={selection.allSelected}
            indeterminate={selection.someSelected && !selection.allSelected}
            onChange={() => selection.toggleAll()}
            aria-label="Select all containers"
          />,
          "Name",
          "Image",
          "Status",
          "CPU",
          "Memory",
          "Net I/O",
          "Ports",
          "Age",
          "ID",
          "",
        ]}
      />
      <tbody>
        {rows.map((row, rowIndex) => {
          const stats = row.state === "running" ? statsMap.get(row.id) : undefined
          return (
            <TRow key={row.id} active={rowIndex === index}>
              <TCell truncate={false}>
                <Checkbox
                  checked={selection.ids.has(row.id)}
                  onChange={() => selection.toggle(row.id)}
                  aria-label={`Select ${row.name || row.id}`}
                />
              </TCell>
              <TCell truncate={false}>
                <span className="flex min-w-0 items-center gap-2">
                  <RowName
                    className="min-w-0"
                    to={`/containers/${row.id}`}
                    onClick={() => setIndex(rowIndex)}
                  >
                    {row.name || "—"}
                  </RowName>
                  <ComposeChip project={row.compose_project} service={row.compose_service} />
                </span>
              </TCell>
              <TCell className="text-muted">{row.image}</TCell>
              <TCell>
                <StatusChip state={row.state} label={row.status} />
              </TCell>
              <TCell className="text-muted tabular-nums">
                {stats ? formatCpuPercent(stats.cpu_percent) : "—"}
              </TCell>
              <TCell className="text-muted tabular-nums">
                {stats ? formatMemUsage(stats.memory_used, stats.memory_limit) : "—"}
              </TCell>
              <TCell className="text-muted tabular-nums">
                {stats ? formatNetIo(stats.net_rx, stats.net_tx) : "—"}
              </TCell>
              <TCell>
                <PortList ports={row.ports} />
              </TCell>
              <TCell className="text-muted">{formatAge(row.created)}</TCell>
              <TCell>
                <CopyId id={row.id} />
              </TCell>
              <RowActions>
                <ContainerActions
                  row={row}
                  act={act}
                  onRename={() => setRenameTarget(row)}
                  onRemove={() => setRemoveTarget(row)}
                />
              </RowActions>
            </TRow>
          )
        })}
      </tbody>
    </Table>
  )

  return (
    <ListPage
      action={
        <>
          {selection.selected.length ? (
            <Button variant="danger" icon={<Trash2 />} onClick={() => setBulkOpen(true)}>
              Remove {selection.selected.length}
            </Button>
          ) : null}
          <Button icon={<Eraser />} disabled={!stopped.length} onClick={() => setPruneOpen(true)}>
            Prune unused
          </Button>
          <RunContainerDialog open={createOpen} trigger onOpenChange={setCreateOpen} />
        </>
      }
    >
      {body}
      <RenameContainerDialog
        open={Boolean(renameTarget)}
        id={renameTarget?.id ?? null}
        name={renameTarget?.name ?? ""}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove container"
        description={`This will permanently remove ${removeTarget?.name ?? "this container"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate([removeTarget.id])}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={bulkOpen}
        title="Remove containers"
        description={`This will permanently remove ${selection.selected.length} selected containers.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate(selection.selected.map((row) => row.id))}
        onClose={() => setBulkOpen(false)}
      />
      <ConfirmDialog
        open={pruneOpen}
        title="Prune unused containers"
        description={`This will remove ${stopped.length} stopped containers.`}
        confirmLabel="Prune"
        danger
        pending={prune.isPending}
        onConfirm={() => prune.mutate()}
        onClose={() => setPruneOpen(false)}
      />
    </ListPage>
  )
}
