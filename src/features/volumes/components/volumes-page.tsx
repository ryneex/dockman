import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eraser, Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { InspectDrawer, RowActions, UsedBy, usageNames } from "@/components/common"
import { ListPage } from "@/components/layouts"
import { useFilter } from "@/components/providers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { TableSkeleton } from "@/components/ui/skeleton"
import { Table, TCell, THead, TRow } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { matchesQuery } from "@/lib/format"
import { isUnused, pruneMessage } from "@/lib/housekeeping"
import { useVolumes } from "@/lib/queries"
import type { VolumeRow } from "@/lib/types"
import { useSelection } from "@/lib/use-selection"
import { useTableNav } from "@/lib/use-table-nav"

import { CreateVolumeDialog } from "./create-volume-dialog"

export function VolumesPage() {
  const query = useVolumes()
  const { query: filter } = useFilter()
  const client = useQueryClient()
  const [inspectName, setInspectName] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<VolumeRow | null>(null)
  const [pruneOpen, setPruneOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const rows = useMemo(
    () =>
      (query.data ?? []).filter((row) =>
        matchesQuery(filter, row.name, row.driver, row.mountpoint, ...usageNames(row.used_by)),
      ),
    [filter, query.data],
  )
  const unused = useMemo(() => (query.data ?? []).filter(isUnused), [query.data])
  const selection = useSelection(rows, (row) => row.name, isUnused)

  const inspect = useQuery({
    queryKey: ["volume-inspect", inspectName],
    queryFn: () => api.volumeInspect(inspectName!),
    enabled: Boolean(inspectName),
  })

  const { index, setIndex } = useTableNav(rows, (row) => setInspectName(row.name))

  const remove = useMutation({
    mutationFn: async (names: string[]) => {
      const errors: string[] = []
      for (const name of names) {
        try {
          await api.volumeRemove(name)
        } catch (error) {
          errors.push(String(error))
        }
      }
      if (errors.length) throw new Error(errors[0])
    },
    onSuccess: (_data, names) => {
      setRemoveTarget(null)
      setBulkOpen(false)
      selection.clear()
      toast.success(names.length > 1 ? `Removed ${names.length} volumes` : "Removed volume")
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => void client.invalidateQueries({ queryKey: ["volumes"] }),
  })

  const prune = useMutation({
    mutationFn: api.volumesPrune,
    onSuccess: (result) => {
      setPruneOpen(false)
      toast.success(pruneMessage("volumes", result))
    },
    onError: (error) => toast.error(String(error)),
    onSettled: () => void client.invalidateQueries({ queryKey: ["volumes"] }),
  })

  const body = query.isError ? (
    <EmptyState
      title="Could not list volumes"
      body={String(query.error)}
      action={{ label: "Retry", onClick: () => void query.refetch(), icon: RefreshCw }}
    />
  ) : query.isLoading ? (
    <TableSkeleton />
  ) : !query.data?.length ? (
    <EmptyState
      title="No volumes"
      body="No named volumes on this engine."
      action={{ label: "New", onClick: () => setCreateOpen(true), icon: Plus }}
    />
  ) : !rows.length ? (
    <EmptyState title="No matches" body="Nothing in this view matches the current filter." />
  ) : (
    <Table cols={["w-12", "w-[22%]", "w-[12%]", "w-[20%]", "w-[38%]", "w-0"]}>
      <THead
        columns={[
          <Checkbox
            key="all"
            checked={selection.allSelected}
            indeterminate={selection.someSelected && !selection.allSelected}
            onChange={() => selection.toggleAll()}
            aria-label="Select unused volumes"
          />,
          "Name",
          "Driver",
          "Used by",
          "Mountpoint",
          "",
        ]}
      />
      <tbody>
        {rows.map((row, rowIndex) => (
          <TRow key={row.name} active={rowIndex === index} onClick={() => setIndex(rowIndex)}>
            <TCell truncate={false}>
              <Checkbox
                checked={selection.ids.has(row.name)}
                disabled={!isUnused(row)}
                onChange={() => selection.toggle(row.name)}
                aria-label={`Select ${row.name}`}
              />
            </TCell>
            <TCell>{row.name}</TCell>
            <TCell className="text-muted">{row.driver}</TCell>
            <TCell>
              <UsedBy items={row.used_by} />
            </TCell>
            <TCell mono>{row.mountpoint}</TCell>
            <RowActions>
              <Tooltip label="Inspect">
                <IconButton
                  onClick={(event) => {
                    event.stopPropagation()
                    setInspectName(row.name)
                  }}
                >
                  <ScanSearch size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip
                label={
                  row.used_by?.length ? `In use by ${usageNames(row.used_by).join(", ")}` : "Remove"
                }
              >
                <IconButton
                  danger
                  disabled={(row.used_by?.length ?? 0) > 0}
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
        ))}
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
          <Button icon={<Eraser />} disabled={!unused.length} onClick={() => setPruneOpen(true)}>
            Prune unused
          </Button>
          <CreateVolumeDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
      }
    >
      {body}
      <InspectDrawer
        open={Boolean(inspectName)}
        title={inspectName ?? "Inspect volume"}
        data={inspect.data}
        loading={inspect.isLoading}
        onClose={() => setInspectName(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove volume"
        description={`This will permanently remove ${removeTarget?.name ?? "this volume"}.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => removeTarget && remove.mutate([removeTarget.name])}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={bulkOpen}
        title="Remove volumes"
        description={`This will permanently remove ${selection.selected.length} unused volumes.`}
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate(selection.selected.map((row) => row.name))}
        onClose={() => setBulkOpen(false)}
      />
      <ConfirmDialog
        open={pruneOpen}
        title="Prune unused volumes"
        description={`This will remove ${unused.length} unused volumes.`}
        confirmLabel="Prune"
        danger
        pending={prune.isPending}
        onConfirm={() => prune.mutate()}
        onClose={() => setPruneOpen(false)}
      />
    </ListPage>
  )
}
